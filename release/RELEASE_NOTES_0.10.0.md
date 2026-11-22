# Calligra v0.10.0

Use **Advanced typesetting** in the workbench or Long Scroll to shape adjacent text with HarfBuzz. The opt-in keeps saved grid layouts editable. The project retains the original text, UTF-16 ranges and OpenType glyph IDs. Long Scroll ZIPs include the same measured PNGs as the preview and a source and placement manifest.

Use automatic or selected tate-chū-yoko for short Latin and numeric groups, or adjust line breaking and punctuation spacing. Line breaks start from UAX #14 with East Asian tailoring. Vertical direction follows UAX #50 and the selected font's vertical substitutions. Arabic, Hebrew and other scripts requiring bidirectional layout remain outside the advanced workbench's supported range.

Exact ideographic variation sequences require the selected font to map them. Unavailable sequences are reported as missing. The optional Companion can produce confirmed variant outlines in cmap format 14 and apply them in eligible DOCX and ODT text when the installed font supports the sequence. Office applications still control pagination and shaping.

**Natural** adjusts spacing and scale. **Fluent** is experimental and ranks existing candidates across a line using bitmap geometry. You can change its intensity and pin a chosen glyph. It preserves the source outlines. An explicitly reviewed local crop can associate multiple connected kana with a single original image. The source scan and region remain available in the personal library.

Use manual crop review or divide a selected text region into regularly spaced rows and columns. The crop tool preserves the original scan. OCR suggestions remain experimental and use independently installed local model files. The historical recognition benchmark remains separate from assisted positioning.

The primary packages are the Web ZIP and Android APK. Windows users can install the [PWA](https://styayur.github.io/calligra/) and run the Companion independently. The [migration guide](https://github.com/styayur/calligra/blob/v0.9.0/docs/PWA_COMPANION.md) covers existing v0.8.1 workspaces. Verify package checksums before installation.
