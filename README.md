<h1 align="center">
  <img src="apps/web/public/icons/calligra-192.png" alt="" width="40" height="40"><br>
  Calligra
</h1>

<p align="center">An open-source East Asian calligraphy workbench for composing, restoring and publishing calligraphic works.</p>

<p align="center">
  <a href="https://styayur.github.io/calligra/"><img src="https://img.shields.io/badge/Web-Open-345747" alt="Open web app"></a>
  <a href="https://github.com/styayur/calligra/releases/latest"><img src="https://img.shields.io/github/v/release/styayur/calligra?label=Release" alt="Latest release"></a>
  <a href="https://github.com/styayur/calligra/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/styayur/calligra/actions/workflows/ci.yml/badge.svg?branch=main" alt="Verify"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

## Examples

[![Vertical Hangul calligraphy](docs/assets/screenshots/korean-vertical.png)](docs/assets/screenshots/korean-vertical.png)

| Chinese cursive long scroll | Vertical Japanese kana |
| :---: | :---: |
| [![Chinese cursive long scroll](docs/assets/screenshots/chinese-long-scroll.png)](docs/assets/screenshots/chinese-long-scroll.png) | [![Vertical Japanese kana](docs/assets/screenshots/japanese-kana.png)](docs/assets/screenshots/japanese-kana.png) |

## Make a work

1. Choose Smart Mix, Chinese calligraphy, Japanese calligraphy or Korean calligraphy. Enter your text and generate a composition.
2. Review proposed glyphs, inspect their origins and confirm any editorial substitutions. Use Advanced Typesetting for vertical punctuation, tate-chū-yoko and OpenType shaping.
3. Save a project to edit later. Export PNG or a PDF with vector font outlines and original-sized historical crops. Long Scroll exports a single multi-page PDF, with PNG ZIP available.

Calligra distinguishes sourced historical glyphs, digital fonts and IDS component compositions. A missing transcription remains open for editorial review. Experimental OCR is an optional Companion feature. See the [source and rights records](docs/DATA_SOURCES.md) and [historical OCR results](docs/HISTORICAL_OCR.md).

## Start using Calligra

| Platform | Start |
| --- | --- |
| Windows, macOS, Linux | Open [Pages](https://styayur.github.io/calligra/) and install the PWA if preferred. Serve the unpacked Web ZIP on localhost for an independent copy. |
| Android 7.0+ | Install the signed APK from [Releases](https://github.com/styayur/calligra/releases/latest). The app can check for updates. |
| Local Companion | Run the [optional local service](docs/PWA_COMPANION.md) for installable font compilation or DOCX/ODT conversion. Artwork PDF runs in the browser or Android app. |

Prepare offline fonts while connected, then work offline. Projects and personal libraries are stored on the device. [Migration and backup guide](docs/MIGRATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

The app is GPL-3.0-or-later. Check the release SHA256SUMS.txt before installing. Each bundled source retains its own rights and attribution.
