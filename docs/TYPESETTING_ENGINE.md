# Unicode and OpenType typesetting

The text planner preserves the original Unicode string, including whitespace and
line endings. Grapheme clusters refer to UTF-16 source ranges. It builds runs
by script, language, tradition, inline direction and vertical orientation.
HarfBuzz glyph positions carry real font IDs, advance and offset metrics, and
absolute source cluster offsets. Project font provenance and rights remain
attached to the glyph.

The line-break dependency implements Unicode 18 UAX #14. Calligra applies
additional restrictions for Japanese small kana and Korean word grouping.
Unbreakable text may overflow a requested measure. Manual tate-chū-yoko ranges
align to grapheme boundaries. A short ASCII sequence is eligible for automatic
tate-chū-yoko only in vertical layout.

Vertical orientation comes from the Unicode 18 Vertical_Orientation table. The
generated lookup records the original data checksum. Upright OpenType shaping
can use vert. Sideways placement uses horizontal advances and a separate
rotation. The engine rejects bidi controls and the supported detection set of
right-to-left scripts until a full bidi layout path is available.

Variation sequences are accepted only if HarfBuzz can resolve the exact mapping
in the selected font. Source Han Serif KR supplies a positive cmap format 14
fixture. Yuji Boku, Yuji Mai and Klee One have real Latin fi ligatures. These
examples provide no evidence of productive connected kana in those fonts.
Historical multi-character images require documented source ranges independent
from GSUB ligatures.

References are [Unicode line breaking](https://www.unicode.org/reports/tr14/),
[vertical orientation](https://www.unicode.org/reports/tr50/),
[ideographic variation sequences](https://www.unicode.org/reports/tr37/),
[bidirectional layout](https://www.unicode.org/reports/tr9/),
[JLReq](https://www.w3.org/TR/jlreq/), and [KLReq](https://www.w3.org/TR/klreq/).
These are the design references for this implementation. The test results
document the specific covered cases.
