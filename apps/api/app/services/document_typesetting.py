"""Apply a local font to selected text in DOCX and ODT main documents."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from io import BytesIO
from pathlib import Path, PurePosixPath
import re
from xml.dom import Node, minidom
from xml.parsers.expat import ExpatError
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from fontTools.ttLib import TTFont, TTLibError
import regex

WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ODT_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"
SVG = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
XML = "http://www.w3.org/XML/1998/namespace"
ODT_MIMETYPE = b"application/vnd.oasis.opendocument.text"
MAX_ARCHIVE = 40 * 1024 * 1024
MAX_UNPACKED = 128 * 1024 * 1024
MAX_XML = 12 * 1024 * 1024


@dataclass(frozen=True)
class Selection:
    headings_only: bool = False
    paragraphs: frozenset[int] = frozenset()
    original_font: str | None = None
    han_only: bool = True


def children(node, ns, name):
    return [child for child in node.childNodes
            if child.nodeType == Node.ELEMENT_NODE and child.namespaceURI == ns and child.localName == name]


def first(node, ns, name):
    return next(iter(children(node, ns, name)), None)


def parse_xml(data):
    if len(data) > MAX_XML:
        raise ValueError("Document XML exceeds the supported size")
    text = data.decode("utf-8-sig")
    if re.search(r"<!\s*(DOCTYPE|ENTITY)\b", text, re.IGNORECASE):
        raise ValueError("DTD and entities are forbidden in document input")
    if "\0" in text:
        raise ValueError("Document XML must use UTF-8")
    return minidom.parseString(text)


def archive_entries(data):
    if not data or len(data) > MAX_ARCHIVE:
        raise ValueError("Office input exceeds 40 MiB")
    with ZipFile(BytesIO(data)) as archive:
        records = archive.infolist()
        if len(records) > 1000 or sum(info.file_size for info in records) > MAX_UNPACKED:
            raise ValueError("Office package exceeds the supported size")
        entries = {}
        seen = set()
        for info in records:
            name = info.filename
            key = name.casefold()
            parts = name.rstrip("/").split("/")
            if (not name or PurePosixPath(name).is_absolute() or any(p in {"", ".", ".."} for p in parts)
                    or "\\" in name or ":" in name or key in seen or info.flag_bits & 1
                    or info.compress_type not in {ZIP_STORED, ZIP_DEFLATED}
                    or (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("Office package has an unsafe or unsupported entry")
            if any(part == "vbaproject.bin" or part in {"scripts", "basic", "_xmlsignatures"}
                   for part in key.split("/")):
                raise ValueError("Macro-enabled and digitally signed documents are unsupported")
            seen.add(key)
            if not info.is_dir():
                entries[name] = archive.read(info)
        return entries


def word_runs(paragraph):
    for node in paragraph.childNodes:
        if node.nodeType != Node.ELEMENT_NODE or node.namespaceURI != WORD:
            continue
        if node.localName == "r":
            yield node
        elif node.localName == "hyperlink":
            yield from children(node, WORD, "r")


def run_text(run):
    nodes = children(run, WORD, "t")
    if len(nodes) != 1 or any(child.nodeType == Node.ELEMENT_NODE and
                             (child.namespaceURI != WORD or child.localName not in {"rPr", "t"})
                             for child in run.childNodes):
        return None, ""
    node = nodes[0]
    return node, "".join(child.data for child in node.childNodes if child.nodeType == Node.TEXT_NODE)


def set_attr(element, namespace, prefix, key, value):
    element.setAttributeNS(namespace, f"{prefix}:{key}", value)


def declare_namespace(doc, namespace, prefix):
    # Declare a distinct prefix to avoid relying on a particular producer's aliases.
    root = doc.documentElement
    if root.getAttribute(f"xmlns:{prefix}") != namespace:
        root.setAttributeNS("http://www.w3.org/2000/xmlns/", f"xmlns:{prefix}", namespace)

def qualified(doc, namespace, prefix, name):
    declare_namespace(doc, namespace, prefix)
    return doc.createElementNS(namespace, f"{prefix}:{name}")


def replace_word(doc, run, pieces, family, han_only):
    for text, use_font in pieces:
        clone = run.cloneNode(True)
        duplicate = first(clone, WORD, "t")
        for child in list(duplicate.childNodes):
            duplicate.removeChild(child)
        duplicate.appendChild(doc.createTextNode(text))
        if text[:1].isspace() or text[-1:].isspace():
            duplicate.setAttributeNS(XML, "xml:space", "preserve")
        if use_font:
            properties = first(clone, WORD, "rPr")
            if properties is None:
                properties = qualified(doc, WORD, "cgWord", "rPr")
                clone.insertBefore(properties, duplicate)
            fonts = first(properties, WORD, "rFonts")
            if fonts is None:
                fonts = qualified(doc, WORD, "cgWord", "rFonts")
                # rStyle, if present, precedes rFonts in the run properties sequence.
                prior = first(properties, WORD, "rStyle")
                properties.insertBefore(fonts, prior.nextSibling if prior else properties.firstChild)
            for slot in ("eastAsia",) if han_only else ("eastAsia", "ascii", "hAnsi", "cs"):
                set_attr(fonts, WORD, "cgWord", slot, family)
                theme = "cstheme" if slot == "cs" else slot + "Theme"
                if fonts.hasAttributeNS(WORD, theme):
                    fonts.removeAttributeNS(WORD, theme)
        run.parentNode.insertBefore(clone, run)
    run.parentNode.removeChild(run)


def word_font(run):
    properties = first(run, WORD, "rPr")
    fonts = first(properties, WORD, "rFonts") if properties else None
    if fonts:
        return fonts.getAttributeNS(WORD, "eastAsia") or fonts.getAttributeNS(WORD, "hAnsi")
    return ""


def word_paragraphs(doc):
    body = first(doc.documentElement, WORD, "body")
    if body is None:
        raise ValueError("DOCX body is absent")
    return [paragraph for paragraph in body.getElementsByTagNameNS(WORD, "p")
            if not inside(paragraph, WORD, {"p", "txbxContent", "ins", "del", "moveTo", "moveFrom"})]


def inside(element, namespace, names):
    parent = element.parentNode
    while parent and parent.nodeType == Node.ELEMENT_NODE:
        if parent.namespaceURI == namespace and parent.localName in names:
            return True
        parent = parent.parentNode
    return False


def word_heading(paragraph):
    properties = first(paragraph, WORD, "pPr")
    if properties is None:
        return False
    style = first(properties, WORD, "pStyle")
    outline = first(properties, WORD, "outlineLvl")
    return ((outline is not None and outline.getAttributeNS(WORD, "val") in set("012345678")) or
            (style is not None and re.fullmatch(r"Heading[1-9]", style.getAttributeNS(WORD, "val"), re.I)))


def odt_paragraphs(doc):
    body = first(doc.documentElement, OFFICE, "body")
    text = first(body, OFFICE, "text") if body else None
    if text is None:
        raise ValueError("ODT body is absent")
    result = []
    def visit(parent):
        for node in parent.childNodes:
            if node.nodeType != Node.ELEMENT_NODE:
                continue
            if node.namespaceURI == ODT_TEXT and node.localName in {"p", "h"}:
                result.append(node)
            elif (node.namespaceURI == ODT_TEXT and node.localName in {"list", "list-item", "section"}) or (
                    node.namespaceURI == "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
                    and node.localName in {"table", "table-row", "table-rows", "table-header-rows", "table-cell"}):
                visit(node)
    visit(text)
    return result


def odt_text_nodes(node):
    for child in list(node.childNodes):
        if child.nodeType == Node.TEXT_NODE:
            yield child
        elif child.nodeType == Node.ELEMENT_NODE and child.namespaceURI == ODT_TEXT and child.localName in {"span", "a"}:
            yield from odt_text_nodes(child)


def make_odt_style(doc, family, han_only):
    root = doc.documentElement
    existing = {el.getAttributeNS(STYLE, "name") for el in root.getElementsByTagNameNS(STYLE, "style")}
    name = "CalligraText"
    while name in existing:
        name += "A"
    faces = first(root, OFFICE, "font-face-decls")
    if faces is None:
        faces = qualified(doc, OFFICE, "cgOffice", "font-face-decls")
        before = next((n for n in root.childNodes if n.nodeType == Node.ELEMENT_NODE and
                       n.namespaceURI == OFFICE and n.localName in {"automatic-styles", "body"}), None)
        root.insertBefore(faces, before)
    face_names = {el.getAttributeNS(STYLE, "name") for el in children(faces, STYLE, "font-face")}
    face_name = "CalligraFace"
    while face_name in face_names:
        face_name += "A"
    face = qualified(doc, STYLE, "cgStyle", "font-face")
    set_attr(face, STYLE, "cgStyle", "name", face_name)
    declare_namespace(doc, SVG, "cgSvg")
    set_attr(face, SVG, "cgSvg", "font-family", family)
    faces.appendChild(face)
    automatic = first(root, OFFICE, "automatic-styles")
    if automatic is None:
        automatic = qualified(doc, OFFICE, "cgOffice", "automatic-styles")
        root.insertBefore(automatic, first(root, OFFICE, "body"))
    style = qualified(doc, STYLE, "cgStyle", "style")
    set_attr(style, STYLE, "cgStyle", "name", name)
    set_attr(style, STYLE, "cgStyle", "family", "text")
    props = qualified(doc, STYLE, "cgStyle", "text-properties")
    for slot in ("font-name-asian",) if han_only else ("font-name", "font-name-asian", "font-name-complex"):
        set_attr(props, STYLE, "cgStyle", slot, face_name)
    style.appendChild(props)
    automatic.appendChild(style)
    return name


def replace_odt(doc, node, pieces, style):
    for text, use_font in pieces:
        element = doc.createTextNode(text)
        if use_font:
            span = qualified(doc, ODT_TEXT, "cgText", "span")
            set_attr(span, ODT_TEXT, "cgText", "style-name", style)
            span.appendChild(element)
            element = span
        node.parentNode.insertBefore(element, node)
    node.parentNode.removeChild(node)


def convert(data, kind, family, coverage, options=Selection()):
    if kind not in {"docx", "odt"} or not family.strip() or len(family) > 120:
        raise ValueError("Invalid document format or font family")
    parts = archive_entries(data)
    odt = kind == "odt"
    main = "content.xml" if odt else "word/document.xml"
    if main not in parts or (parts.get("mimetype") != ODT_MIMETYPE if odt else "[Content_Types].xml" not in parts):
        raise ValueError("Office package does not match its declared format")
    if not odt and b"macroEnabled" in parts["[Content_Types].xml"]:
        raise ValueError("Macro-enabled documents are unsupported")
    if odt and options.original_font:
        raise ValueError("Original-font matching is currently supported for direct DOCX run fonts only")
    doc = parse_xml(parts[main])
    if odt and (doc.documentElement.namespaceURI, doc.documentElement.localName) != (OFFICE, "document-content"):
        raise ValueError("Unexpected ODT content root")
    if not odt and (doc.documentElement.namespaceURI, doc.documentElement.localName) != (WORD, "document"):
        raise ValueError("Unexpected DOCX content root")
    if odt and any(doc.getElementsByTagNameNS(ODT_TEXT, marker) for marker in
                   ("tracked-changes", "change", "change-start", "change-end")):
        raise ValueError("ODT documents with tracked changes must be reviewed before conversion")
    paragraphs = odt_paragraphs(doc) if odt else word_paragraphs(doc)
    missing, required = set(), set()
    report = {"paragraphs": [], "selected_paragraphs": [], "skipped_complex_paragraphs": [], "changed_segments": 0}
    style = None

    def plan(value):
        pieces = []
        for cluster in regex.findall(r"\X", value):
            target = (regex.fullmatch(r"\p{Script=Han}\p{M}*", cluster) if options.han_only
                      else not cluster.isspace())
            eligible = bool(target) and len(cluster) == 1 and ord(cluster) in coverage
            if target:
                required.add(cluster)
                if not eligible:
                    missing.add(cluster)
            if pieces and pieces[-1][1] == eligible:
                pieces[-1] = (pieces[-1][0] + cluster, eligible)
            else:
                pieces.append((cluster, eligible))
        return pieces

    for number, paragraph in enumerate(paragraphs, 1):
        heading = paragraph.localName == "h" if odt else bool(word_heading(paragraph))
        plain = "".join(node.data for node in odt_text_nodes(paragraph)) if odt else "".join(
            "".join(c.data for c in node.childNodes if c.nodeType == Node.TEXT_NODE)
            for node in paragraph.getElementsByTagNameNS(WORD, "t") if not inside(node, WORD, {"txbxContent"}))
        report["paragraphs"].append({"number": number, "heading": heading, "text": plain})
        if (options.headings_only and not heading) or (options.paragraphs and number not in options.paragraphs):
            continue
        report["selected_paragraphs"].append(number)
        if not odt and any(paragraph.getElementsByTagNameNS(WORD, item)
                           for item in ("fldSimple", "fldChar", "instrText", "ins", "del", "moveTo", "moveFrom", "txbxContent")):
            report["skipped_complex_paragraphs"].append(number)
            continue
        candidates = [(node, node.data) for node in odt_text_nodes(paragraph)] if odt else [
            (run, run_text(run)[1]) for run in word_runs(paragraph)
            if not options.original_font or word_font(run) == options.original_font]
        for node, value in candidates:
            pieces = plan(value)
            changes = sum(use_font for _, use_font in pieces)
            if not changes:
                continue
            if odt:
                if style is None:
                    style = make_odt_style(doc, family, options.han_only)
                replace_odt(doc, node, pieces, style)
            else:
                replace_word(doc, node, pieces, family, options.han_only)
            report["changed_segments"] += changes
    report["required_characters"] = sorted(required)
    report["missing_characters"] = sorted(missing)
    report["scope"] = "Main document text; headers, footers, and embedded/complex objects are not edited."
    report["layout_verified"] = False
    if not report["changed_segments"]:
        return data, report
    parts[main] = doc.toxml(encoding="utf-8")
    result = BytesIO()
    with ZipFile(result, "w", ZIP_DEFLATED) as archive:
        if odt:
            archive.writestr("mimetype", parts.pop("mimetype"), compress_type=ZIP_STORED)
        for name, payload in parts.items():
            archive.writestr(name, payload)
    return result.getvalue(), report


def convert_with_font(document, kind, font_data, selection=Selection()):
    if len(font_data) < 12 or len(font_data) > MAX_ARCHIVE or not font_data.startswith((b"\0\1\0\0", b"OTTO")):
        raise ValueError("Choose an installable TTF or OTF")
    with TTFont(BytesIO(font_data), lazy=True) as font:
        family = font["name"].getBestFamilyName()
        if not family:
            raise ValueError("Font family absent")
        output, report = convert(document, kind, family, set(font.getBestCmap() or {}), selection)
    report["font_family"] = family
    return output, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    parser.add_argument("font", type=Path, help="Local TTF or OTF with actual character coverage")
    parser.add_argument("--output", type=Path, help="Omit to only show analysis")
    parser.add_argument("--headings", action="store_true")
    parser.add_argument("--paragraphs", nargs="+", type=int, default=[])
    parser.add_argument("--original-font")
    parser.add_argument("--all-characters", action="store_true")
    parser.add_argument("--pdf", type=Path, help="Optional PDF output from local LibreOffice")
    parser.add_argument("--libreoffice", type=Path, help="Local LibreOffice executable for --pdf")
    args = parser.parse_args()
    try:
        if args.document.stat().st_size > MAX_ARCHIVE or args.font.stat().st_size > MAX_ARCHIVE:
            raise ValueError("Input exceeds the supported file size")
        if args.font.suffix.lower() not in {".ttf", ".otf"}:
            raise ValueError("Choose an installable TTF or OTF")
        kind = args.document.suffix.lower().lstrip(".")
        if args.output and args.output.suffix.lower() != "." + kind:
            raise ValueError("Output must use the input document format")
        output, report = convert_with_font(args.document.read_bytes(), kind, args.font.read_bytes(),
                                           Selection(args.headings, frozenset(args.paragraphs),
                                                     args.original_font, not args.all_characters))
        if args.pdf:
            if not args.libreoffice or args.pdf.suffix.lower() != ".pdf":
                raise ValueError("PDF output requires a .pdf destination and --libreoffice")
            from app.services.document_pdf import render_pdf
            rendered = render_pdf(output, kind, args.libreoffice)
            with args.pdf.open("xb") as file:
                file.write(rendered)
        if args.output:
            with args.output.open("xb") as file:
                file.write(output)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, BadZipFile, ExpatError, TTLibError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
