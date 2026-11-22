# Calligra

An offline workbench for composing, comparing and exporting Chinese, Japanese and Korean calligraphy.

[简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Open Calligra](https://styayur.github.io/calligra/) · [Releases](https://github.com/styayur/calligra/releases/latest)

The offline workbench offers Simplified Chinese, Japanese, Korean and English interfaces. Choose the UI language, text language and glyph tradition independently.

![Running Japanese workbench with font candidates, vertical composition and Visual Profile](docs/japanese-workbench.png)

## Features

- Chinese, Japanese, and Korean traditions are separated by default; cross-tradition exploration is explicit.
- Compose up to 1,000 characters, replace glyphs, adjust layout and ink, then save project JSON or export artwork. Long-roll mode arranges up to 20,000 characters across pages.
- Visual Profile compares shape, ink density, balance and spacing. Scores help compare candidates; they do not measure artistic quality.
- Bundled fonts and samples work without an account or mandatory API. Sources and applicable rights stay attached to projects and historical-artwork exports.

Japanese sources include Yuji, Klee One, a labelled Source Han Serif JP coverage subset and 20 attributed CODH historical crops. Fonts are contemporary interpretations, not manuscript originals. See [Japanese coverage](docs/JAPANESE_COVERAGE.md), [data sources](docs/DATA_SOURCES.md) and [Visual Profile](docs/visual-profiles.md) for evidence and boundaries.

## Installation / Quick Start

### Desktop and Android

| Platform | Start |
|---|---|
| Windows, macOS and Linux | Open [Calligra Pages](https://styayur.github.io/calligra/) and optionally install the PWA. The Web ZIP can be served on localhost. |
| Android 7.0 or later | Install the production-signed APK from [GitHub Releases](https://github.com/styayur/calligra/releases/latest). Use **App updates** for subsequent versions. |
| Local Companion | Optional Python service for fonts, DOCX/ODT, PDF and experimental OCR. |

Check the official ZIP and APK against the release's SHA256SUMS.txt. To run the extracted ZIP, use `python -m http.server 8080 --bind 127.0.0.1` and open `http://127.0.0.1:8080`. While online, use **Download offline fonts** to prepare all fonts for offline use.

The last Windows Electron installer and portable application stay on the [v0.8.1 release](https://github.com/styayur/calligra/releases/tag/v0.8.1). The [desktop guide](docs/PWA_COMPANION.md) covers read-only project and personal-library migration and the separate Companion setup.

### First composition

1. Open the demo or a local package. Select **Chinese**, **Japanese** or **Korean**, enter text and choose a layout.
2. Generate a composition. Select a glyph to inspect its source, compare alternatives and preview a replacement.
3. Save project JSON to continue editing, or export artwork. Back up projects before upgrading; see [schema migrations](docs/MIGRATIONS.md).

Drafts and caches stay on the current device. Export files for backup or transfer. **Long-roll results last only for the current session: export the page ZIP before refreshing.**

### Run from source

Use Node.js 22 (the CI version) and npm:

```sh
git clone https://github.com/styayur/calligra.git
cd calligra/apps/web
npm ci
npm run dev -- --mode offline
```

Open the URL printed by Vite, normally `http://localhost:5173`. Offline mode uses bundled static assets; the optional FastAPI/SQLite corpus service is not required. Its development dependencies need Python 3.11+; installation and test commands follow below. See [architecture](docs/ARCHITECTURE.md) and [contributing](CONTRIBUTING.md) for corpus and platform development.

## Testing / CI / Platform Support

[![Verify](https://github.com/styayur/calligra/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/styayur/calligra/actions/workflows/ci.yml)

From `apps/web`:

```sh
npm run typecheck
npm run test:visual
npm run build:offline
```

For the optional API, from `apps/api`:

```sh
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

The [Verify workflow](.github/workflows/ci.yml) also runs dependency audits, asset/provenance checks, built-browser regressions, Windows browser installation and migration tests, standalone Companion tests and Android package builds. [CodeForge regression](.github/workflows/codeforge-regression.yml) is an existing development gate. The release workflow checks a production-signed Android emulator upgrade. Device-specific results are reported separately.

## Known Limitations

- Japanese text uses glyph cells. Full kinsoku, connected-kana continuity, tate-chū-yoko, arbitrary IVS and complete mixed-script vertical orientation are not implemented.
- Historical samples and orthography remain limited. Nanum covers modern Korean. Regional Hanja and the tested archaic Jamo fixture use Source Han Serif KR. Historical OCR suggestions require manual verification.
- Large ZIP exports are assembled in memory; rendering can vary between platforms. Long-roll mode does not provide individual glyph dragging.
- Older clients may discard newer project fields when resaving. Keep a backup before moving projects between versions.

## Roadmap

Next work includes reviewed Japanese mappings and vertical layout coverage, easier local corpus installation, and native-device export validation. Composition presets and tablet input remain future directions. [Phase gates](docs/PHASE_GATES.md) distinguish implemented work from conditional research; no delivery dates are promised.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and asset provenance rules. Report reproducible bugs through [Issues](https://github.com/styayur/calligra/issues); use [SECURITY.md](SECURITY.md) for vulnerabilities. Do not commit local databases, caches, exports or unlicensed assets.

## License

Application code is [GPL-3.0-or-later](LICENSE), as declared by current manifests. Fonts, images, datasets and software retain their own terms: OFL-1.1 fonts, CC BY-SA 4.0 CODH crops and derivatives, and ARPHIC-licensed Hanzi Writer structural data. Restricted MCCD/HCSU data and the full CODH corpus are not bundled.

See [font licenses](docs/FONT_LICENSES.md), [asset policy](docs/asset-policy.md) and [third-party inventory](third_party/manifest.json). Current generated notices take the application license from its manifest, correcting stale MIT labels after the recorded GPL adoption. Historical downloads are not rebuilt or retroactively relicensed; review the terms included in the version you obtain. Third-party license texts and receipts retain their own terms.
