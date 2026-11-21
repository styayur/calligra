# v0.8.0 acceptance scope

## Image rights

The upstream VIPLab README records permission for the lab to reorganize and redistribute images sourced from shufa.supfree.net. Its MIT notice covers the repository's software and documentation. Neither public notice establishes downstream image redistribution rights. Remove the 30 image byte sequences and associated glyph, search and licence metadata from the candidate. Release validation checks excluded hashes and paths in the public tree, Web ZIP, Windows ASAR and Android APK. Local importer tests generate their own geometric images. The local NCCU provider makes no commercial-use, derivation or font rights assertions. [Institutional dataset README](https://github.com/nccuviplab/CursiveChineseCalligraphyDataset) · [Repository MIT notice](https://github.com/nccuviplab/CursiveChineseCalligraphyDataset/blob/master/LICENSE)

## Historical page and recognition

The page regression measures projection boxes against three published crop labels from the illustrated CODH scan of *ぢぐち*. It then uses the actual Materials UI to draw the three manual boxes, confirm the labels, save privately, reopen and check the byte checksum of the recovered scan. The fixture manifest provides dimensions, coordinates, licence and image receipt. Metrics are partial-page observations. The release CI publishes the measured IoU values alongside the manual checks. [CODH page and annotation source](https://codh.rois.ac.jp/char-shape/book/200006663/)

Historical OCR scored 0/20. Modern print weights are optional and their suggestions require explicit review. A future evaluation can compare separate detector and recognizer stages on held-out annotated pages, stratify vertical print and cursive, and score localization, exact transcription and abstention independently. CODH's KuroNet is a candidate for Japanese historical text research. Chinese rubbings need their own labelled evaluation pages and rights review. [CODH KuroNet](https://codh.rois.ac.jp/kuronet/)

## Platform receipts

Compare the commit in each build receipt with the tested PR head or signed tag. Windows exercises packaged Electron, the installed NSIS build, the Companion bootstrap, GDI font loading and DOCX/ODT round trips. The Android upgrade job verifies the retained production certificate and installs the v0.7.1 public APK followed by the candidate on an Android emulator. Physical-device coverage is tracked independently. The Web job checks the unpacked ZIP with Chromium. See the release notes for the platform support matrix.

## Storage incident

An earlier I/O failure followed a dropped connection to E:. On 2026-11-22 PowerShell reported the reconnected NTFS volume as Healthy / OK and its physical disk as Healthy / Online. The reported capacity was 298.09 GiB with 99.71 GiB free. The volume root and repository directory were readable. These checks were read-only. Status is recovered, and the independent C: checkout remains the release workspace.
