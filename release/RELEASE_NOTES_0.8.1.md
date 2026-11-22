# Calligra v0.8.1

Japanese composition, glyph search and single-glyph replacement now select individual families from the installed catalog. Choose Yuji Boku, Yuji Syuku, Yuji Mai or Klee One by name. Akari and Akebono are labelled historical kana. JP Coverage Serif is labelled supplementary coverage.

A selected family supplies the glyphs it can render. Missing characters leave an empty cell and are listed in the feedback. Enable **缺字时允许其他日文字体补字** to fill those gaps with other Japanese fonts. The automatic mode uses ordinary Japanese fonts and keeps supplementary coverage opt-in.

The selected family and fallback preference are saved in project JSON. v0.8.0 projects reopen in automatic mode unless a new family is selected. Existing artwork, legacy projects, Chinese style selection and Japanese HarfBuzz shaping remain compatible. Android upgrades from v0.8.0 with the existing application ID and production signing identity.
