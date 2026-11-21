# Calligra v0.8.0

The Calligra workbench adds a bundled guide, local scan extraction, private and optional glyph libraries, outline font compilation, and selective DOCX and ODT typesetting.

- **集字** keeps the existing Chinese and Japanese composition, project recovery, glyph replacement, long-roll, and PNG/ZIP export. The guide is included in the offline bundle.
- **素材** accepts local PNG, JPEG, and static WebP. Page segmentation proposes boxes for manual review, with optional local OCR suggestions. Confirmed glyphs keep their scan checksum, coordinates, processing settings, and review status. Local glyph-pack chunks can be imported, disabled, and removed independently.
- **字体** builds TTF, CFF OTF, and WOFF2 outlines from eligible, selected raster glyphs. It reports missing characters, licence restrictions, and low-resolution sources. Standard outlines simplify ink texture, and the export currently maps individual Unicode scalars.
- **文档** applies an installed font to covered text in DOCX or ODT main content. The local service reports missing characters and skipped complex paragraphs. Optional local LibreOffice export supports screened documents. Page layout can change with the selected font.

The local Python companion provides font compilation and document conversion. The Pages, portable Web, Windows, and Android workbenches retain offline composition. See the bundled guide for configuration, supported input, and limits.
