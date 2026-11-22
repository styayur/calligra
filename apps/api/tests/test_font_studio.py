from base64 import b64encode
from hashlib import sha256
from io import BytesIO

import freetype
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw
import pytest
import uharfbuzz as hb

from app.schemas import GlyphRead
from app.services.font_studio import USER_PERMISSION, compile_font


def glyph(character, *, permission=True):
    image = Image.new("RGBA", (64, 64))
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((6, 6, 55, 55), fill="black")
    drawing.rectangle((14, 14, 46, 46), fill=(0, 0, 0, 0))
    drawing.rectangle((14, 34, 46, 38), fill="black")
    file = BytesIO()
    image.save(file, "PNG")
    data = file.getvalue()
    return GlyphRead.model_validate({
        "id": character, "character": character,
        "source": {"dataset": "test synthetic shapes", "license": USER_PERMISSION,
                   "rights": {"redistribution_allowed": permission, "derivatives_allowed": permission}},
        "asset": {"type": "raster", "url": "data:image/png;base64," + b64encode(data).decode(),
                  "width": 64, "height": 64, "bbox": [0, 0, 64, 64], "checksum": sha256(data).hexdigest()},
    })


def test_formats_coverage_and_rasterization():
    files, coverage = compile_font(
        [glyph("日"), glyph("月"), glyph("𠀀"), glyph("水", permission=False)],
        "日月𠀀水山", "Calligra Test", {"ttf", "otf", "woff2"}, approved_work=True,
    )
    assert coverage["covered"] == ["日", "月", "𠀀"]
    assert coverage["missing"] == ["水", "山"]
    assert [item["character"] for item in coverage["blocked"]] == ["水"]
    assert "SOURCE-LICENSES.txt" in files and "attribution.json" in files
    for extension, table, magic in (("ttf", "glyf", b"\0\1\0\0"), ("otf", "CFF ", b"OTTO"),
                                    ("woff2", "glyf", b"wOF2")):
        data = files[f"CalligraTest-Regular.{extension}"]
        assert data.startswith(magic)
        with TTFont(BytesIO(data)) as font:
            assert table in font and set(font.getBestCmap()) == {32, ord("日"), ord("月"), ord("𠀀")}
            font.flavor = None
            sfnt = BytesIO()
            font.save(sfnt)
        sfnt.seek(0)
        face = freetype.Face(sfnt)
        face.set_pixel_sizes(0, 80)
        face.load_char("日")
        assert face.glyph.bitmap.width > 0 and any(face.glyph.bitmap.buffer)
        shape_font = hb.Font(hb.Face(sfnt.getvalue()))
        buffer = hb.Buffer()
        buffer.add_str("日月𠀀水")
        buffer.guess_segment_properties()
        hb.shape(shape_font, buffer)
        assert [item.codepoint > 0 for item in buffer.glyph_infos] == [True, True, True, False]


def test_private_rights_and_asset_integrity():
    character = glyph("日")
    with pytest.raises(ValueError, match="rights confirmation"):
        compile_font([character], "日", "Calligra Test", {"ttf"})
    character.asset.checksum = "0" * 64
    with pytest.raises(ValueError, match="SHA-256"):
        compile_font([character], "日", "Calligra Test", {"ttf"}, approved_work=True)


def test_confirmed_ivs_builds_a_distinct_cmap_14_entry():
    base, variant, absent = "垕", "垕\U000E0102", "垕\U000E01EF"
    files, coverage = compile_font([glyph(base), glyph(variant), glyph("fi")],
                                   f"{base}{variant}{absent}", "Calligra Test",
                                   {"ttf", "otf", "woff2"}, approved_work=True)
    assert coverage["covered"] == [base, variant]
    assert coverage["missing"] == [absent]
    for fmt in ("ttf", "otf", "woff2"):
        with TTFont(BytesIO(files[f"CalligraTest-Regular.{fmt}"])) as font:
            table = next(table for table in font["cmap"].tables if table.format == 14)
            assert table.uvsDict == {0xE0102: [(ord(base), "uvs5795.E0102")]}
            assert font.getBestCmap()[ord(base)] != "uvs5795.E0102"
            font.flavor = None
            sfnt = BytesIO()
            font.save(sfnt)
        shaper = hb.Font(hb.Face(sfnt.getvalue()))
        assert shaper.get_variation_glyph(ord(base), 0xE0102) != shaper.get_nominal_glyph(ord(base))
        assert shaper.get_variation_glyph(ord(base), 0xE01EF) is None
