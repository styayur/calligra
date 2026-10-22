# Calligra

中国語・日本語の書を集字し、字形の比較から作品の書き出しまで行うオフラインの作業環境です。

[English](README.md) · [简体中文](README.zh-CN.md) · [デモ](https://styayur.github.io/calligra/) · [v0.7.1 をダウンロード](https://github.com/styayur/calligra/releases/tag/v0.7.1)

**開発段階：Alpha。** 自動検証とリリース成果物はありますが、独立した利用者によるインストール、更新、継続利用の検証は未完了です。現在のアプリケーションのマニフェストと公開済み配布版はともに 0.7.1 ですが、既定ブランチの変更が既存の配布物に自動で含まれるわけではありません。

![実行中の日本語ワークベンチ：字体候補、縦書きの作品、Visual Profile](docs/japanese-workbench.png)

## 機能

- 中国語と日本語の書字伝統は既定で分離され、伝統をまたぐ探索には明示的な選択が必要です。
- 最大 1,000 字を集字し、字形の置換、配置や墨色の調整、プロジェクト JSON の保存、作品の書き出しができます。長巻モードでは最大 20,000 字をページに分けて配置できます。
- Visual Profile は形状、墨の密度、バランス、字間を比較します。スコアは候補の比較を補助し、芸術的価値は評価しません。
- 同梱フォントとサンプルはアカウントや必須 API なしで使えます。プロジェクトと歴史字形を使う作品の書き出しには、出典と適用される権利情報が付属します。

日本語の素材は Yuji、Klee One、補完用と明記した Source Han Serif JP サブセット、出典を付した CODH の歴史字形切り抜き 20 点です。フォントは現代の解釈であり、原手稿ではありません。根拠と制約は[日本語の字形カバレッジ](docs/JAPANESE_COVERAGE.md)、[データ出典](docs/DATA_SOURCES.md)、[Visual Profile](docs/visual-profiles.md)を参照してください。

## インストール / クイックスタート

### 公開済みの配布版

| 環境 | v0.7.1 の配布物 | 起動方法 |
|---|---|---|
| Windows x64 | [インストーラー](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Setup-0.7.1-x64.exe)または[ポータブル版](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Portable-0.7.1-x64.exe) | インストール後に起動、またはポータブル版を実行 |
| Web | [オフライン ZIP](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Web-0.7.1.zip) | 展開してローカル HTTP サーバーで開く |
| Android | [APK](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Android-0.7.1.apk) | Android 7.0 以降 |

既存のファイル名は `CalligraphyStudio` のままです。[SHA256SUMS.txt](https://github.com/styayur/calligra/releases/download/v0.7.1/SHA256SUMS.txt)で照合してください。Windows では `Get-FileHash <file> -Algorithm SHA256` を使えます。Windows 版は未署名です。Android は継続利用する v0.7.1 の署名鍵を使用しますが、実機での保存、共有、ライフサイクルの受け入れ検証は未完了です。[署名の説明](docs/RELEASE_SIGNING_0.7.1.md)を参照してください。

オフライン Web ZIP はフォルダー構成を保って展開し、展開先で実行します。

```sh
python -m http.server 8080
```

`http://localhost:8080` を開きます。ローカルサーバーには Python 3 が必要です。ダウンロード後の編集にインターネットは不要です。`index.html` のダブルクリックによる起動はサポートしません。公開デモは最初に GitHub Pages から素材を取得します。明確なオフライン実行には配布物をダウンロードしてください。

### 最初の作品

1. デモまたは配布版を開き、**Chinese** または **Japanese**、文字列、レイアウトを選びます。
2. 作品を生成します。字形を選択し、出典の確認、候補の比較、置換のプレビューを行います。
3. 編集を続けるにはプロジェクト JSON を保存し、完成品は書き出します。更新前にバックアップし、[スキーマ移行](docs/MIGRATIONS.md)を確認してください。

下書きとキャッシュは現在の端末に保存されます。バックアップや移行にはファイルを書き出してください。**長巻の生成結果は現在のセッションだけで有効です。再読み込み前にページ ZIP を書き出してください。**

### ソースから起動

Node.js 22（CI の使用版）と npm を使います。

```sh
git clone https://github.com/styayur/calligra.git
cd calligra/apps/web
npm ci
npm run dev -- --mode desktop
```

Vite が表示する URL（通常は `http://localhost:5173`）を開きます。desktop モードは同梱の静的素材を使い、任意の FastAPI/SQLite コーパスサービスは必要ありません。このサービスの開発依存関係には Python 3.11 以降が必要です。インストールとテストの手順は次節を参照してください。コーパスと環境別の開発は[構成](docs/ARCHITECTURE.md)と[貢献ガイド](CONTRIBUTING.md)で説明しています。

## テスト / CI / 対応環境

[![Verify](https://github.com/styayur/calligra/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/styayur/calligra/actions/workflows/ci.yml)

`apps/web` で実行します。

```sh
npm run typecheck
npm run test:visual
npm run build:desktop
```

任意の API の検証は `apps/api` で実行します。

```sh
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

[Verify ワークフロー](.github/workflows/ci.yml)は依存関係監査、素材・出典の検証、ビルド後のブラウザー回帰テスト、Windows 配布物の描画検証、Android パッケージのビルドも行います。[CodeForge regression](.github/workflows/codeforge-regression.yml)は既存の開発用チェックです。Windows x64、Web、Android の配布物はありますが、ビルドと自動描画検証だけではインストール、更新、実機の受け入れ検証を完了したことにはなりません。

## 既知の制約

- 日本語は字ごとのセルで配置します。完全な禁則処理、連綿仮名、縦中横、任意の IVS、複数の文字体系が混在する縦書きでの完全な文字方向処理は未実装です。
- 歴史資料のサンプルと表記・字体の対応関係は限定的で、韓国語には対応しません。UI は主に中国語で、英語と一部の日本語用語を併用します。README の翻訳は UI 全体の日本語対応を意味しません。
- 大きな ZIP はメモリー上で組み立てます。描画結果は環境によって異なり、長巻モードでは字を個別にドラッグできません。
- Windows のインストール、更新、IME と、Android 実機の保存、共有、ライフサイクルは未検証です。旧クライアントで再保存すると v2 プロジェクトの一部のフィールドが失われる場合があります。

## ロードマップ

今後は日本語の字形対応表と縦書き範囲の検証、ローカルコーパスの導入改善、実機での書き出し検証を進める予定です。配置プリセットとタブレット入力は将来の方向性です。[段階別の条件](docs/PHASE_GATES.md)では実装済み機能と条件付きの研究を分けており、提供時期は約束しません。

## 貢献

開発と素材の出典要件は [CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。再現可能な不具合は [Issues](https://github.com/styayur/calligra/issues)へ、脆弱性は [SECURITY.md](SECURITY.md)の手順で報告してください。ローカル DB、キャッシュ、書き出し結果、許諾のない素材はコミットしないでください。

## ライセンス

現在のマニフェストはアプリケーションコードを [GPL-3.0-or-later](LICENSE)としています。フォント、画像、データセット、依存ソフトウェアには個別の条件があります。フォントは OFL-1.1、CODH の切り抜きと派生物は CC BY-SA 4.0、NCCU サンプルは MIT、Hanzi Writer の構造データは ARPHIC のライセンスです。制限付き MCCD/HCSU データと CODH の全コーパスは同梱していません。

[フォントライセンス](docs/FONT_LICENSES.md)、[素材方針](docs/asset-policy.md)、[第三者一覧](third_party/manifest.json)を参照してください。一部の過去の文書や自動生成通知には、アプリケーションコードを MIT とする記述が残り、現在の LICENSE と矛盾しています。その記述は LICENSE に代わるものではありません。今回の README 変更では通知の不整合を修正せず、過去のリリースや第三者素材のライセンスも変更しません。
