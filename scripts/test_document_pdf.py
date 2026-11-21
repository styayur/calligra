"""Render and compare the real round-trip fixtures with local LibreOffice."""
import argparse
from io import BytesIO
from pathlib import Path
import sys

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
from app.services.document_pdf import render_pdf
from app.services.document_typesetting import convert_with_font
from test_document_typesetting import docx, odt


def inspect(data):
    reader = PdfReader(BytesIO(data))
    text = "".join(page.extract_text() for page in reader.pages)
    fonts = set()
    for page in reader.pages:
        for value in page["/Resources"]["/Font"].values():
            font = value.get_object()
            descendant = font.get("/DescendantFonts", [font])[0].get_object()
            descriptor = descendant.get("/FontDescriptor")
            if descriptor and any(key in descriptor.get_object() for key in ("/FontFile", "/FontFile2", "/FontFile3")):
                fonts.add(str(font["/BaseFont"]).lstrip("/").split("+")[-1])
    return len(reader.pages), "".join(text.split()), fonts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--libreoffice", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--expected-pdf-font", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for kind, create in (("docx", docx), ("odt", odt)):
        original = create()
        converted, report = convert_with_font(original, kind, args.font.read_bytes())
        assert report["changed_segments"] == 4 and not report["missing_characters"]
        before = render_pdf(original, kind, args.libreoffice)
        after = render_pdf(converted, kind, args.libreoffice)
        before_info, after_info = inspect(before), inspect(after)
        assert before_info[:2] == after_info[:2]
        assert all(character in after_info[1] for character in "日月")
        assert args.expected_pdf_font in after_info[2]
        (args.output / f"{kind}-original.pdf").write_bytes(before)
        (args.output / f"{kind}-converted.pdf").write_bytes(after)
        print(f"PASS: {kind.upper()} retains {after_info[0]} pages and text, embeds {args.expected_pdf_font}")


if __name__ == "__main__":
    main()
