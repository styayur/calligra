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

REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
XLINK = "http://www.w3.org/1999/xlink"


def package(entries):
    data = BytesIO()
    with ZipFile(data, "w", ZIP_DEFLATED) as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload, compress_type=ZIP_STORED if name == "mimetype" else ZIP_DEFLATED)
    return data.getvalue()


def pixel_image():
    data = BytesIO()
    Image.new("RGB", (6, 6), "#dd6600").save(data, format="PNG")
    return data.getvalue()


def docx():
    return package({
        "[Content_Types].xml": f"""<Types xmlns="{CT}">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="png" ContentType="image/png"/>
          <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
          <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        </Types>""",
        "_rels/.rels": f"""<Relationships xmlns="{PKG_REL}">
          <Relationship Id="doc" Type="{REL}/officeDocument" Target="word/document.xml"/>
        </Relationships>""",
        "word/_rels/document.xml.rels": f"""<Relationships xmlns="{PKG_REL}">
          <Relationship Id="link" Type="{REL}/hyperlink" Target="https://example.org/" TargetMode="External"/>
          <Relationship Id="image" Type="{REL}/image" Target="media/pixel.png"/>
          <Relationship Id="styles" Type="{REL}/styles" Target="styles.xml"/>
        </Relationships>""",
        "word/styles.xml": f"""<w:styles xmlns:w="{WORD}">
          <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
        </w:styles>""",
        "word/media/pixel.png": pixel_image(),
        "word/document.xml": f"""<w:document xmlns:w="{WORD}" xmlns:r="{REL}"
           xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
           xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Western"
           w:eastAsia="Old" w:eastAsiaTheme="majorEastAsia"/><w:b/></w:rPr><w:t>日 and 月</w:t></w:r></w:p>
          <w:p><w:hyperlink r:id="link"><w:r><w:rPr><w:i/></w:rPr><w:t>link 日</w:t></w:r></w:hyperlink></w:p>
          <w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc>
           <w:p><w:r><w:t>月 table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:r><w:drawing><wp:inline><wp:extent cx="57150" cy="57150"/>
           <wp:docPr id="1" name="Pixel"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
           <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr>
           <pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
           <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="57150" cy="57150"/></a:xfrm>
           <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
           </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
          <w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>日</w:t></w:r></w:fldSimple>
           <m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></w:p>
          <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
         </w:body></w:document>""",
    })


def odt():
    manifest = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
    return package({
        "mimetype": ODT_MIMETYPE,
        "META-INF/manifest.xml": f"""<manifest:manifest xmlns:manifest="{manifest}" manifest:version="1.3">
          <manifest:file-entry manifest:full-path="/" manifest:media-type="{ODT_MIMETYPE.decode()}"/>
          <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
          <manifest:file-entry manifest:full-path="Pictures/pixel.png" manifest:media-type="image/png"/>
        </manifest:manifest>""",
        "Pictures/pixel.png": pixel_image(),
        "content.xml": f"""<office:document-content xmlns:office="{OFFICE}" xmlns:text="{ODT_TEXT}" xmlns:style="{STYLE}"
          xmlns:table="{TABLE}" xmlns:draw="{DRAW}" xmlns:xlink="{XLINK}" office:version="1.3">
          <office:automatic-styles><style:style style:name="Emphasis" style:family="text"><style:text-properties
           xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" fo:font-style="italic"/></style:style></office:automatic-styles>
          <office:body><office:text><text:h text:outline-level="1">日 and 月</text:h>
          <text:p><text:a xlink:href="https://example.org/"><text:span text:style-name="Emphasis">link 日</text:span></text:a></text:p>
          <table:table table:name="Table"><table:table-column/><table:table-row><table:table-cell><text:p>月 table</text:p></table:table-cell></table:table-row></table:table>
          <text:p><draw:frame text:anchor-type="as-char"><draw:image xlink:href="Pictures/pixel.png"/></draw:frame></text:p>
          </office:text></office:body>
         </office:document-content>""",
    })


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
