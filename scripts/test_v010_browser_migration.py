"""Upgrade a real v0.10.0 Web profile and verify its portable project and private library."""
import argparse
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright
from test_extraction_browser import fixture


def download(page, label):
    with page.expect_download() as event:
        page.get_by_role("button", name=label, exact=True).click()
    return Path(event.value.path()).read_bytes()


def exercise(base, current):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(server.app), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, _format, *_args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        server.app = base
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            return upgrade(f"http://127.0.0.1:{server.server_port}/", partial(setattr, server, "app", current))
        finally:
            server.shutdown()
            worker.join()


def upgrade(url, switch):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 960},
                                      accept_downloads=True, service_workers="block")
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(url)
        assert page.request.get(url + "build-meta.json").json()["version"] == "0.10.0"
        page.get_by_label("集字内容").fill("明月")
        page.get_by_role("button", name="生成作品", exact=True).click()
        expect(page.locator(".composer .feedback")).to_contain_text("已排入 2 字")
        project = download(page, "保存项目")
        page.get_by_role("button", name="素材", exact=True).click()
        page.get_by_label("原图", exact=True).set_input_files(
            {"name": "retained-scan.png", "mimeType": "image/png", "buffer": fixture()})
        page.get_by_role("button", name="自动定位").click()
        page.get_by_label("确认文字").fill("日")
        page.get_by_role("button", name="保存确认字形").click()
        expect(page.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")
        page.get_by_text("备份与恢复个人字库", exact=True).click()
        library = download(page, "导出个人字库备份")
        assert len(json.loads(library)["glyphs"]) == 1

        switch()
        page.reload()
        assert page.request.get(url + "build-meta.json").json()["version"] == "0.11.0"
        expect(page.get_by_label("集字内容")).to_have_value("明月")
        assert json.loads(project)["glyphs"] == json.loads(download(page, "保存项目"))["glyphs"]
        page.locator('input[type=file]').set_input_files(
            {"name": "v0.10.0-project.json", "mimeType": "application/json", "buffer": project})
        expect(page.get_by_text("项目已载入", exact=True)).to_be_visible()
        reopened = json.loads(download(page, "保存项目"))
        assert reopened["text"] == "明月" and reopened["glyphs"] == json.loads(project)["glyphs"]
        assert not reopened.get("restorations")
        page.get_by_role("button", name="素材", exact=True).click()
        page.get_by_text("备份与恢复个人字库", exact=True).click()
        reexported = download(page, "导出个人字库备份")
        assert json.loads(library) == json.loads(reexported)
        browser.close()
    return {"from": "0.10.0", "to": "0.11.0", "glyphs": len(reopened["glyphs"]),
            "library_sha256": sha256(reexported).hexdigest(), "round_trip": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    receipt = exercise(args.baseline.resolve(), args.current.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(receipt)


if __name__ == "__main__":
    main()
