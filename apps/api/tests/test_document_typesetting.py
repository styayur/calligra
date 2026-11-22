from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
import xml.etree.ElementTree as ET

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.config import Settings
from app.routes.workbench import router
from app.services.document_typesetting import OFFICE, ODT_MIMETYPE, ODT_TEXT, STYLE, WORD
from app.services.document_typesetting import Selection, archive_entries, convert, convert_with_font
from app.services.font_studio import compile_font
from test_font_studio import glyph

from document_fixtures import REL, PKG_REL, CT, DRAW, TABLE, XLINK, docx, odt, package, pixel_image


@pytest.fixture(scope="module")
def font_bytes():
    files, _ = compile_font([glyph("日")], "日", "Calligra Test", {"ttf"}, approved_work=True)
    return files["CalligraTest-Regular.ttf"]


@pytest.mark.parametrize("kind,factory,part", [("docx", docx, "word/document.xml"), ("odt", odt, "content.xml")])
def test_round_trip(kind, factory, part, font_bytes):
    original = factory()
    output, report = convert_with_font(original, kind, font_bytes)
    assert report["font_family"] == "Calligra Test"
    assert report["required_characters"] == ["日", "月"] and report["missing_characters"] == ["月"]
    assert report["changed_segments"] == 2 and report["paragraphs"][0]["heading"]
    original_parts, output_parts = archive_entries(original), archive_entries(output)
    assert original_parts.keys() == output_parts.keys()
    assert all(output_parts[key] == data for key, data in original_parts.items() if key != part)
    before, after = (ET.fromstring(parts[part]) for parts in (original_parts, output_parts))
    if kind == "docx":
        text = lambda node: "".join(t.text for t in node.findall(f".//{{{WORD}}}t"))
        assert report["skipped_complex_paragraphs"] == [5]
        assert after.find(f".//{{{WORD}}}hyperlink").get(f"{{{REL}}}id") == "link"
        assert after.find(f".//{{{WORD}}}pgSz").get(f"{{{WORD}}}w") == "12240"
        assert after.find(f".//{{{WORD}}}tbl") is not None
        title = after.find(f".//{{{WORD}}}p")
        parts = title.findall(f"{{{WORD}}}r")
        assert len(parts) == 2 and all(run.find(f".//{{{WORD}}}b") is not None for run in parts)
        new, unaffected = (run.find(f".//{{{WORD}}}rFonts") for run in parts)
        assert new.get(f"{{{WORD}}}eastAsia") == "Calligra Test"
        assert new.get(f"{{{WORD}}}eastAsiaTheme") is None and new.get(f"{{{WORD}}}ascii") == "Western"
        assert unaffected.get(f"{{{WORD}}}eastAsia") == "Old"
    else:
        def text(node):
            body = node.find(f".//{{{OFFICE}}}body")
            return "".join("".join(el.itertext()) for el in body.iter() if el.tag in {f"{{{ODT_TEXT}}}p", f"{{{ODT_TEXT}}}h"})
        assert after.find(f".//{{{XLINK}}}a") is None
        assert after.find(f".//{{{ODT_TEXT}}}a").get(f"{{{XLINK}}}href") == "https://example.org/"
        assert after.find(f".//{{{TABLE}}}table") is not None
        styles = after.findall(f".//{{{STYLE}}}text-properties")
        assert [el.get(f"{{{STYLE}}}font-name-asian") for el in styles] == [None, "CalligraFace"]
        with ZipFile(BytesIO(output)) as archive:
            assert archive.infolist()[0].filename == "mimetype"
            assert archive.infolist()[0].compress_type == ZIP_STORED
    assert text(before) == text(after)
    _, reopened = convert_with_font(output, kind, font_bytes, Selection(headings_only=True))
    assert reopened["required_characters"] == ["日", "月"] and reopened["selected_paragraphs"] == [1]


def test_select_paragraph_original_font_and_unsafe_package():
    _, report = convert(docx(), "docx", "New font", {ord("日")}, Selection(original_font="Old"))
    assert report["changed_segments"] == 1
    output, report = convert(docx(), "docx", "New font", {ord("日")}, Selection(paragraphs=frozenset({2})))
    assert report["changed_segments"] == 1 and report["selected_paragraphs"] == [2]
    with pytest.raises(ValueError, match="unsafe"):
        archive_entries(package({"../escape.xml": "outside the archive"}))
    original = archive_entries(docx())
    original["word/document.xml"] = '<!DOCTYPE w:document [<!ENTITY entity "anything">]>' + original["word/document.xml"].decode()
    with pytest.raises(ValueError, match="entities"):
        convert(package(original), "docx", "New font", {ord("日")})


@pytest.mark.parametrize("kind,factory,part", [("docx", docx, "word/document.xml"), ("odt", odt, "content.xml")])
def test_ivs_coverage_in_document_round_trip(kind, factory, part):
    covered, missing = "日\U000E0102", "月\U000E0102"
    original = archive_entries(factory())
    original[part] = original[part].decode().replace("日", covered).replace("月", missing)
    files, _ = compile_font([glyph(covered), glyph("月")], covered + "月",
                            "Calligra Test", {"ttf"}, approved_work=True)
    output, report = convert_with_font(package(original), kind, files["CalligraTest-Regular.ttf"])
    assert report["required_characters"] == [covered, missing]
    assert report["missing_characters"] == [missing]
    assert report["changed_segments"] == 2
    text = "".join(ET.fromstring(archive_entries(output)[part]).itertext())
    assert covered in text and missing in text


def test_local_route_analyze_convert_and_reject_external_origin(font_bytes):
    app = FastAPI()
    app.state.settings = Settings()
    app.include_router(router)
    path = f"/workbench/documents/docx?font_bytes={len(font_bytes)}"
    headers = {"content-type": "application/octet-stream", "origin": "http://127.0.0.1:5173"}
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
        content = font_bytes + docx()
        response = client.post(path + "&analyze=true", content=content, headers=headers)
        assert response.status_code == 200 and response.json()["missing_characters"] == ["月"]
        converted = client.post(path, content=content, headers=headers)
        assert converted.status_code == 200
        assert set(archive_entries(converted.content)) == {"Calligra.docx", "analysis.json"}
        response = client.post(path, content=content, headers={**headers, "origin": "https://example.org"})
        assert response.status_code == 403
