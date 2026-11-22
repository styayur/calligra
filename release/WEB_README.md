# Calligraphy Studio 网页离线包

这是已经构建的静态网页，不需要安装 Node.js 或 API。

1. 解压整个压缩包，保留全部子目录，包括 `fonts/`、`demo/`、`japanese/`、`licenses/` 和 `assets/`。
2. 在解压目录启动 HTTP 服务，例如已安装 Python 时运行 `python -m http.server 8080 --bind 127.0.0.1`。
3. 打开 http://127.0.0.1:8080 。请勿直接双击 `index.html`，浏览器会限制本地文件请求。

字库随压缩包分发。浏览器可以安装 PWA，在工作台点击「下载离线字体」后即使停止本机 HTTP 服务也可离线集字。草稿和私人字库保存在当前浏览器和地址下。长期保存请分别下载项目 JSON 和个人字库备份。

中文样本许可位于 `demo/licenses/`，字体许可位于 `fonts/licenses/`，CODH 许可位于 `japanese/licenses/`，HarfBuzz 许可位于 `licenses/`；其他第三方说明见 `THIRD_PARTY_NOTICE.md`。字体不是历史原迹，CODH 样本及其墨迹蒙版独立遵循 CC BY-SA 4.0，不属于代码的 GPL-3.0-or-later 许可。

工作台支持 1000 字；长卷模式支持最多 20000 字。长卷结果仅保留于当前会话，刷新前请导出 ZIP。Visual Profile 与特征缓存需要现代浏览器的 Worker、Web Crypto 与 IndexedDB 支持。

字体编译、DOCX/ODT、可选 PDF 和实验 OCR 可连接独立本地 Companion。基本集字、项目和图片导出可离线工作。Windows 迁移和 Companion：[使用说明](https://github.com/styayur/calligra/blob/v0.9.0/docs/PWA_COMPANION.md)。
