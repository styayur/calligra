# Calligra v0.8.0

Calligra adds a bundled guide, local scan extraction, private glyph libraries, font compilation and selective DOCX and ODT typesetting.

| Feature | GitHub Pages | Local Web ZIP | Windows x64 | Android |
| --- | --- | --- | --- | --- |
| Chinese and Japanese composition, private glyph libraries, manual scan cropping and PNG/ZIP export | Built in | Built in | Built in | Built in |
| Font coverage, glyph selection and font project JSON | Built in | Built in | Built in | Built in |
| TTF, OTF and WOFF2 compilation, DOCX and ODT conversion | Use Windows or local Web | Start Companion separately | Start Companion in the app | Use Windows or local Web |
| Experimental OCR suggestions | Use local Web | Separately configured Companion and model | Use local Web with the optional model | Use local Web |
| Optional PDF conversion | Use local Web | Separately configured Companion and LibreOffice | Use local Web with LibreOffice | Use local Web |

On Windows, install 64-bit Python 3.12 or 3.13, then select **启动 Companion** in Font Studio or Documents. The first start needs Internet access for the isolated Python dependencies. The app runs font and document processing locally afterward. The standard Windows Companion has neither OCR weights nor a PDF renderer.

Materials accepts local PNG, JPEG and static WebP. Projection provides provisional boxes. Correct the boxes and enter the text before saving. Confirmed glyphs keep the source checksum, crop coordinates and processing settings. On the historical OCR benchmark the current models got 0 of 20 exact matches. Optional suggestions use models trained on modern print and need manual review. The guide covers supported files and processing limits.

Font compilation reports missing characters, licence restrictions and low-resolution sources. Fonts use vector outlines and map individual Unicode scalars. A generated font must be available on the device opening the converted DOCX or ODT. Document conversion covers eligible text in supported structures. Review pagination and skipped content in the target editor.

The original-image sample uses CC BY-SA 4.0 CODH materials with attribution. The optional NCCU data provider accepts independently obtained local files. No NCCU image or derived image ships with this release.
