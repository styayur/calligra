"""Compile confirmed, licensed Glyph records into monochrome outline fonts."""

from __future__ import annotations

import argparse
import base64
from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image
import regex

from app.domain import require_rights
from app.schemas import GlyphRead

SUPPORTED = {"ttf", "otf", "woff2"}
MAX_REQUEST = 32 * 1024 * 1024
MAX_GLYPHS = 512
USER_PERMISSION = "用户确认可改作及再分发"
ALLOWED_LICENSES = {"CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", USER_PERMISSION}
Point = tuple[int, int]


def supported_character(text: str) -> bool:
    return len(text) == 1 and regex.fullmatch(r"[\p{L}\p{N}\p{P}\p{S}]", text) is not None


def read_mask(glyph: GlyphRead, assets: Path | None) -> Image.Image:
    url = glyph.asset.url
    if url.startswith("data:image/png;base64,"):
        data = base64.b64decode(url.split(",", 1)[1], validate=True)
    elif assets and url.startswith("/assets/"):
        root = assets.resolve()
        path = (root / url.removeprefix("/assets/")).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Invalid local asset path")
        data = path.read_bytes()
    else:
        raise ValueError("Font compilation accepts local PNG assets")
    if len(data) > 8 * 1024 * 1024 or sha256(data).hexdigest() != glyph.asset.checksum:
        raise ValueError("Glyph asset SHA-256 mismatch or excessive bytes")
    with Image.open(BytesIO(data), formats=["PNG"]) as image:
        if image.size != (glyph.asset.width, glyph.asset.height) or image.width * image.height > 5_000_000:
            raise ValueError("Invalid or excessive glyph dimensions")
        alpha = image.convert("RGBA").getchannel("A")
        if alpha.getextrema() == (255, 255):
            grey = image.convert("L")
            corners = [grey.getpixel(point) for point in ((0, 0), (0, grey.height - 1),
                       (grey.width - 1, 0), (grey.width - 1, grey.height - 1))]
            if sorted(corners)[2] >= 128:
                grey = grey.point(lambda v: 255 - v)
            alpha = grey
        alpha.thumbnail((192, 192), Image.Resampling.LANCZOS)
        mask = alpha.point(lambda value: 255 if value >= 112 else 0)
        bounds = mask.getbbox()
        if not bounds:
            raise ValueError(f"Empty ink mask for {glyph.character}")
        return mask.crop(bounds)


def contours(mask: Image.Image) -> list[list[Point]]:
    """Trace unit pixel edges and retain corners only, including inner contours."""
    width, height = mask.size
    pixels = mask.load()
    edges: dict[Point, set[Point]] = defaultdict(set)
    for y in range(height):
        for x in range(width):
            if not pixels[x, y]:
                continue
            if y == 0 or not pixels[x, y - 1]:
                edges[x, y].add((x + 1, y))
            if x == width - 1 or not pixels[x + 1, y]:
                edges[x + 1, y].add((x + 1, y + 1))
            if y == height - 1 or not pixels[x, y + 1]:
                edges[x + 1, y + 1].add((x, y + 1))
            if x == 0 or not pixels[x - 1, y]:
                edges[x, y + 1].add((x, y))
    loops = []
    while edges:
        start = next(iter(edges))
        previous, current = start, min(edges[start])
        loop = [start]
        while True:
            edges[previous].remove(current)
            if not edges[previous]:
                del edges[previous]
            if current == start:
                break
            dx, dy = current[0] - previous[0], current[1] - previous[1]
            straight = (current[0] + dx, current[1] + dy)
            right = (current[0] - dy, current[1] + dx)
            options = edges[current]
            next_point = right if right in options else straight if straight in options else min(options)
            if next_point != straight:
                loop.append(current)
            previous, current = current, next_point
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def emit_outline(pen, mask: Image.Image):
    width, height = mask.size
    scale = 860 / max(width, height)
    left = (1000 - width * scale) * .5
    top = 790 - (860 - height * scale) * .5
    for loop in contours(mask):
        points = [(round(left + x * scale), round(top - y * scale)) for x, y in loop]
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()


def compile_font(glyphs: list[GlyphRead], target: str, family: str, formats: set[str],
                 assets: Path | None = None, approved_work: bool = False):
    """The first explicitly selected eligible form wins for a given scalar."""
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 -]{1,47}", family):
        raise ValueError("Use a font family of 2–48 ASCII letters, digits, spaces or hyphens")
    family = family.strip()
    if not formats or not formats <= SUPPORTED or len(glyphs) > MAX_GLYPHS or len(target) > 4096:
        raise ValueError("Invalid format selection, target text or glyph count")
    requested = list(dict.fromkeys(c for c in regex.findall(r"\X", target) if not c.isspace()))
    selected: dict[str, GlyphRead] = {}
    blocked = []
    for glyph in glyphs:
        if requested and glyph.character not in requested:
            continue
        try:
            require_rights(glyph.source.rights, bundle=True, derivative=True)
            if glyph.source.rights.get("font_export_allowed") is False:
                raise ValueError("Source explicitly prohibits font export")
            if glyph.source.license not in ALLOWED_LICENSES or glyph.provenance.type != "original":
                raise ValueError("This source has not been cleared for font generation")
            if glyph.source.license == USER_PERMISSION and not approved_work:
                raise ValueError("Private sources require explicit local rights confirmation")
            if not supported_character(glyph.character):
                raise ValueError("Multi-codepoint sequences and control characters are outside this export")
        except ValueError as error:
            blocked.append({"id": glyph.id, "character": glyph.character, "reason": str(error)})
            continue
        selected.setdefault(glyph.character, glyph)

    masks = {c: read_mask(glyph, assets) for c, glyph in selected.items()}
    coverage = {
        "requested": requested,
        "covered": list(selected),
        "missing": [character for character in requested if character not in selected],
        "blocked": blocked,
        "low_resolution": [c for c, mask in masks.items() if max(mask.size) < 40],
        "glyphs": [
            {"id": glyph.id, "character": c, "source": glyph.source.model_dump(),
             "asset_sha256": glyph.asset.checksum, "processing": glyph.metadata}
            for c, glyph in selected.items()
        ],
    }
    if not masks:
        raise ValueError("No eligible glyphs. " + json.dumps(coverage, ensure_ascii=False))

    # ShareAlike is propagated with its source attribution in the output package.
    licenses = {glyph.source.license for glyph in selected.values()}
    if "CC-BY-SA-4.0" in licenses and USER_PERMISSION in licenses:
        raise ValueError("This export cannot mix ShareAlike and private sources")
    derivative_license = "CC-BY-SA-4.0" if "CC-BY-SA-4.0" in licenses else ""
    coverage["outline_derivation"] = "Binary raster contours normalized to a 1000-unit em"
    coverage["derivative_license"] = derivative_license or None
    coverage["variant_selection"] = "One confirmed outline per scalar; alternative shapes are not assigned to another character."
    ps_name = family.replace(" ", "") + "-Regular"
    cmap = {ord(c): f"uni{ord(c):04X}" if ord(c) <= 0xffff else f"u{ord(c):05X}" for c in masks}
    order = [".notdef", "space", *(cmap[k] for k in sorted(cmap))]
    cmap[32] = "space"
    timestamp = int((datetime(2026, 1, 1, tzinfo=timezone.utc) - datetime(1904, 1, 1, tzinfo=timezone.utc)).total_seconds())
    names = {
        "familyName": family, "styleName": "Regular", "fullName": family + " Regular",
        "psName": ps_name, "uniqueFontIdentifier": ps_name + ":1.000",
        "version": "Version 1.000",
        "licenseDescription": derivative_license or "See SOURCE-LICENSES.txt and attribution.json",
    }
    if derivative_license:
        names["licenseInfoURL"] = "https://creativecommons.org/licenses/by-sa/4.0/"
    payloads = {}
    for is_ttf in (True, False):
        needed = formats & ({"ttf", "woff2"} if is_ttf else {"otf"})
        if not needed:
            continue
        builder = FontBuilder(1000, isTTF=is_ttf)
        builder.font.recalcTimestamp = False
        builder.setupHead(created=timestamp, modified=timestamp)
        builder.setupGlyphOrder(order)
        builder.setupCharacterMap(cmap)
        outlines = {}
        image_by_name = {cmap[ord(c)]: image for c, image in masks.items()}
        for name in order:
            pen = TTGlyphPen(None) if is_ttf else T2CharStringPen(1000 if name != "space" else 500, None)
            if name in image_by_name:
                emit_outline(pen, image_by_name[name])
            outlines[name] = pen.glyph() if is_ttf else pen.getCharString()
        if is_ttf:
            builder.setupGlyf(outlines)
        else:
            builder.setupCFF(ps_name, {"FullName": names["fullName"], "FamilyName": family}, outlines, {})
        metrics = {name: (1000, 0) for name in order}
        metrics["space"] = (500, 0)
        for name, image in image_by_name.items():
            metrics[name] = (1000, round((1000 - image.width * 860 / max(image.size)) * .5))
        builder.setupHorizontalMetrics(metrics)
        builder.setupHorizontalHeader(ascent=880, descent=-120)
        builder.setupNameTable(names)
        builder.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=880, usWinDescent=120)
        builder.setupPost()
        for fmt in sorted(needed):
            builder.font.flavor = "woff2" if fmt == "woff2" else None
            data = BytesIO()
            builder.font.save(data)
            payloads[f"{ps_name}.{fmt}"] = data.getvalue()
    if derivative_license:
        license_file = Path(__file__).resolve().parents[4] / "third_party/japanese/codh/CC-BY-SA-4.0.txt"
        if license_file.is_file():
            payloads["CC-BY-SA-4.0.txt"] = license_file.read_bytes()
    payloads["attribution.json"] = json.dumps(coverage, ensure_ascii=False, indent=2).encode()
    payloads["SOURCE-LICENSES.txt"] = (
        "Outline-derived font. Refer to each credited source and retain its licence terms.\n"
        + (f"Adapted font licence: {derivative_license} {names['licenseInfoURL']}\n" if derivative_license else "")
        + "\n".join(f"{c}: {g.source.attribution or g.source.calligrapher or g.source.dataset} | "
                    f"{g.source.license} {g.source.license_url or ''} | {g.source.source_uri or ''}"
                    for c, g in selected.items())
    ).encode()
    return payloads, coverage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Font Studio request JSON or saved Calligra project JSON")
    parser.add_argument("output", type=Path, help="Destination ZIP with font and attribution files")
    parser.add_argument("--family")
    parser.add_argument("--text", default="")
    parser.add_argument("--formats", nargs="+", choices=sorted(SUPPORTED))
    parser.add_argument("--assets", type=Path, help="Root for locally stored glyph assets")
    parser.add_argument("--confirm-private-rights", action="store_true")
    args = parser.parse_args()
    try:
        if args.input.stat().st_size > MAX_REQUEST:
            raise ValueError("Font request exceeds 32 MiB")
        request = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(request, dict) or not isinstance(request.get("glyphs"), list) or len(request["glyphs"]) > MAX_GLYPHS:
            raise ValueError("Expected a JSON object with at most 512 glyphs")
        glyphs = [GlyphRead.model_validate(entry) for entry in request["glyphs"]]
        target = args.text or request.get("text", "")
        if not isinstance(target, str):
            raise ValueError("Target text must be a string")
        family = args.family or request.get("family", "Calligra Collection")
        formats = args.formats or request.get("formats", sorted(SUPPORTED))
        if not isinstance(family, str) or not isinstance(formats, list) or not all(isinstance(fmt, str) for fmt in formats):
            raise ValueError("Expected a font family and a list of font formats")
        payloads, coverage = compile_font(glyphs, target, family, set(formats), args.assets, args.confirm_private_rights)
        with ZipFile(args.output, "x", ZIP_DEFLATED) as archive:
            for name, data in payloads.items():
                archive.writestr(name, data)
        print(json.dumps({key: coverage[key] for key in ("covered", "missing", "blocked", "low_resolution")}, ensure_ascii=False))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
