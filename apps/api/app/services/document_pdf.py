"""Optional local LibreOffice rendering for vetted Office packages."""
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from app.services.document_typesetting import ODT_TEXT, WORD, archive_entries, parse_xml

XLINK = "http://www.w3.org/1999/xlink"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
SAFE_FIELDS = re.compile(r"\s*(?:PAGE|NUMPAGES)(?:\s+\\\*\s+MERGEFORMAT)?\s*", re.I)


def check_pdf_input(data, kind):
    entries = archive_entries(data)
    for name, payload in entries.items():
        if name.lower().startswith(("word/embeddings/", "object ", "objectreplacements/")):
            raise ValueError("PDF rendering does not accept embedded office objects")
        if not name.endswith((".xml", ".rels")):
            continue
        doc = parse_xml(payload)
        for element in doc.getElementsByTagName("*"):
            if element.namespaceURI == PACKAGE_REL and element.localName == "Relationship":
                if element.getAttribute("TargetMode") == "External":
                    target = urlsplit(element.getAttribute("Target"))
                    if not (element.getAttribute("Type").endswith("/hyperlink") and
                            target.scheme in {"https", "http", "mailto"}):
                        raise ValueError("PDF rendering does not accept auto-loaded external references")
            if kind == "docx" and element.namespaceURI == WORD:
                if element.localName == "fldSimple" and not SAFE_FIELDS.fullmatch(element.getAttributeNS(WORD, "instr")):
                    raise ValueError("PDF rendering does not accept this document field")
                if element.localName in {"instrText", "object", "altChunk", "subDoc", "control", "ins", "del"}:
                    raise ValueError("PDF rendering requires plain reviewed content")
            if kind == "odt":
                href = element.getAttributeNS(XLINK, "href")
                if href and not (href.startswith("#") or href in entries):
                    target = urlsplit(href)
                    if not (element.namespaceURI == ODT_TEXT and element.localName == "a" and
                            target.scheme in {"https", "http", "mailto"}):
                        raise ValueError("PDF rendering does not accept externally linked ODT content")
                if element.localName in {"dde-connection", "script", "scripts", "event-listener", "object", "object-ole"}:
                    raise ValueError("PDF rendering requires plain reviewed content")


def render_pdf(data: bytes, kind: str, executable: Path) -> bytes:
    if kind not in {"docx", "odt"} or not executable.is_file():
        raise ValueError("Choose a supported document and a local LibreOffice executable")
    check_pdf_input(data, kind)
    with TemporaryDirectory(prefix="calligra-render-") as directory:
        root = Path(directory)
        profile = root / "profile"
        user = profile / "user"
        user.mkdir(parents=True)
        (user / "registrymodifications.xcu").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            '</item></oor:items>', encoding="utf-8",
        )
        source = root / f"calligra.{kind}"
        source.write_bytes(data)
        try:
            result = subprocess.run(
                [str(executable.resolve()), f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
                 "--convert-to", "pdf:writer_pdf_Export", "--outdir", str(root), str(source)],
                capture_output=True, timeout=120, check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ValueError("LibreOffice PDF conversion timed out") from error
        pdf = root / "calligra.pdf"
        if result.returncode or not pdf.is_file() or pdf.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("LibreOffice did not produce a PDF within the supported limits")
        rendered = pdf.read_bytes()
        if not rendered.startswith(b"%PDF-"):
            raise ValueError("LibreOffice did not produce a valid PDF signature")
        return rendered
