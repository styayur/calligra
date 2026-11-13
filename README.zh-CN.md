# Calligra

用于中文和日文书法集字、比较与导出的离线工作台。

[English](README.md) · [日本語](README.ja.md) · [在线演示](https://styayur.github.io/calligra/) · [下载 v0.7.1](https://github.com/styayur/calligra/releases/tag/v0.7.1)

**阶段：Alpha。** 已有自动检查与发布产物；独立用户的安装、升级和持续使用验证仍待完成。当前应用清单与已发布下载均为 0.7.1，但默认分支的修改不会自动进入已有下载包。

![实际运行的日文工作台：字体候选、竖排作品与 Visual Profile](docs/japanese-workbench.png)

## 功能

- 默认区分中文和日文书写传统，跨传统探索需要显式选择。
- 工作台最多集字 1,000 字，可逐字替换、调整排版与墨色，保存项目 JSON 或导出作品；长卷模式支持最多 20,000 字分页排版。
- Visual Profile 比较形态、墨色密度、平衡与间距，评分辅助候选比较，不评判艺术质量。
- 内置字体与样本不需要账户或必选 API。项目和历史字形作品导出保留来源及适用的权利信息。

日文来源包括 Yuji、Klee One、明确标记的 Source Han Serif JP 补字子集，以及 20 幅带署名的 CODH 历史字形裁图。字体是当代诠释，不是手稿原件。证据与边界见[日文字库覆盖](docs/JAPANESE_COVERAGE.md)、[数据来源](docs/DATA_SOURCES.md)和 [Visual Profile](docs/visual-profiles.md)。

## 安装 / 快速开始

### 已发布软件包

| 平台 | v0.7.1 软件包 | 启动方式 |
|---|---|---|
| Windows x64 | [安装程序](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Setup-0.7.1-x64.exe)或[便携程序](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Portable-0.7.1-x64.exe) | 安装后启动，或直接运行便携程序 |
| Web | [离线 ZIP](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Web-0.7.1.zip) | 解压后通过本地 HTTP 服务打开 |
| Android | [APK](https://github.com/styayur/calligra/releases/download/v0.7.1/CalligraphyStudio-Android-0.7.1.apk) | Android 7.0 及以上 |

历史文件名仍使用 `CalligraphyStudio`。下载后对照 [SHA256SUMS.txt](https://github.com/styayur/calligra/releases/download/v0.7.1/SHA256SUMS.txt) 校验；Windows 可用 `Get-FileHash <file> -Algorithm SHA256`。Windows 软件包未签名。Android 使用持久化的 v0.7.1 签名密钥，真机存储、分享与生命周期验收尚未完成。详见[签名说明](docs/RELEASE_SIGNING_0.7.1.md)。

离线 Web ZIP 解压后保留目录结构，在解压目录运行：

```sh
python -m http.server 8080
```

打开 `http://localhost:8080`。本地服务需要 Python 3；下载完成后，编辑不需要联网。不支持通过双击 `index.html` 启动。在线演示首次需从 GitHub Pages 下载资源；需要明确的离线运行方式时，请使用下载包。

### 第一幅作品

1. 打开演示或本地软件包，选择 **Chinese** 或 **Japanese**，输入文字并选择排版。
2. 生成作品，点选字形查看来源、比较候选并预览替换。
3. 保存项目 JSON 以便继续编辑，或导出作品。升级前备份项目，参阅[格式迁移](docs/MIGRATIONS.md)。

草稿与缓存保存在当前设备；备份或迁移请导出文件。**长卷结果仅在当前会话有效，刷新前必须导出分页 ZIP。**

### 从源码运行

使用 Node.js 22（CI 使用的版本）和 npm：

```sh
git clone https://github.com/styayur/calligra.git
cd calligra/apps/web
npm ci
npm run dev -- --mode desktop
```

打开 Vite 输出的地址，通常为 `http://localhost:5173`。desktop 模式使用内置静态资源，不依赖可选的 FastAPI/SQLite 语料服务。该服务的开发依赖需要 Python 3.11 及以上，安装与测试命令见下节。语料与平台开发见[架构](docs/ARCHITECTURE.md)和[贡献指南](CONTRIBUTING.md)。

## 测试 / CI / 平台支持

[![Verify](https://github.com/styayur/calligra/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/styayur/calligra/actions/workflows/ci.yml)

在 `apps/web` 运行：

```sh
npm run typecheck
npm run test:visual
npm run build:desktop
```

可选 API 的检查在 `apps/api` 运行：

```sh
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

[Verify 工作流](.github/workflows/ci.yml)还执行依赖审计、资源与来源检查、构建后浏览器回归、Windows 打包程序渲染检查和 Android 构建。[CodeForge regression](.github/workflows/codeforge-regression.yml)是已有开发门禁。Windows x64、Web 与 Android 有发布产物，但构建与自动渲染检查不能替代安装、升级或真机验收。

## 已知限制

- 日文使用独立字格；尚未实现完整禁则、连绵假名、纵中横、任意 IVS 和完整混排竖排方向支持。
- 历史样本与字形映射有限，不支持韩文。界面主要是中文，辅以英文和部分日文术语；README 翻译不代表应用界面已完整本地化。
- 大型 ZIP 在内存中组装，跨平台渲染可能有差异；长卷模式不支持逐字拖动。
- Windows 安装、升级、输入法及 Android 真机存储、分享、生命周期仍待验收。旧客户端重新保存时可能丢弃 v2 项目字段。

## 路线图

接下来包括审核日文字形映射与竖排覆盖、简化本地语料安装、完成原生设备导出验收。排版预设和平板输入仍是未来方向。[阶段门禁](docs/PHASE_GATES.md)区分已实现功能与有条件的研究工作，不承诺交付日期。

## 贡献

[CONTRIBUTING.md](CONTRIBUTING.md)说明开发与资源来源要求。可复现问题请提交 [Issue](https://github.com/styayur/calligra/issues)，漏洞请遵循 [SECURITY.md](SECURITY.md)。不要提交本地数据库、缓存、导出文件或无许可资源。

## 许可证

当前清单将应用代码声明为 [GPL-3.0-or-later](LICENSE)。字体、图像、数据集和软件依赖保留各自条款：字体为 OFL-1.1，CODH 裁图及其衍生物为 CC BY-SA 4.0，NCCU 样本为 MIT，Hanzi Writer 结构数据采用 ARPHIC 许可。受限 MCCD/HCSU 数据和完整 CODH 语料未随软件分发。

详见[字体许可](docs/FONT_LICENSES.md)、[资源政策](docs/asset-policy.md)和[第三方清单](third_party/manifest.json)。当前生成声明从应用清单读取许可证，修正了此前采用 GPL 后遗留的 MIT 标记。历史下载包不重新构建或追溯重新许可，请查看所下载版本附带的条款；第三方许可文本和来源记录保留各自条款。
