"""Synthetic DOCX and ODT input shared by API and browser tests."""
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from PIL import Image

from app.services.document_typesetting import OFFICE, ODT_MIMETYPE, ODT_TEXT, STYLE, WORD

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
