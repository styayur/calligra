"""Exercise new workspaces against a running local companion and Web bundle."""
import argparse
from io import BytesIO
import json
import os
from queue import Empty, Queue
from subprocess import PIPE, Popen
from threading import Thread
from urllib.parse import urlsplit
from pathlib import Path
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from fontTools.ttLib import TTFont
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
from test_document_typesetting import docx, odt, OFFICE, STYLE, WORD
from test_extraction_browser import fixture


def verify_windows_font(data):
    from ctypes import POINTER, WinDLL, byref, c_uint32, c_void_p, create_string_buffer
    gdi = WinDLL("gdi32")
    gdi.AddFontMemResourceEx.argtypes = (c_void_p, c_uint32, c_void_p, POINTER(c_uint32))
    gdi.AddFontMemResourceEx.restype = c_void_p
    gdi.RemoveFontMemResourceEx.argtypes = (c_void_p,)
    payload = create_string_buffer(data)
    fonts = c_uint32()
    handle = gdi.AddFontMemResourceEx(payload, len(data), None, byref(fonts))
    assert handle and fonts.value >= 1, "Windows GDI rejected the generated TTF"
    assert gdi.RemoveFontMemResourceEx(handle)


def exercise_workbench(page, *, installed_windows=False, verify_gdi=False):
    if installed_windows:
        page.get_by_role("button", name="文档", exact=True).click()
        expect(page.get_by_label("文档", exact=True)).to_be_disabled()
        expect(page.get_by_text("首次启动会联网安装依赖。", exact=False)).to_be_visible()
        page.get_by_role("button", name="启动 Companion", exact=True).click()
        result = page.locator(".companion-controls").get_by_text("Companion 已就绪", exact=False).or_(
            page.locator(".companion-controls").get_by_role("alert")
        )
        expect(result).to_be_visible(timeout=380000)
        assert "Companion 已就绪" in result.inner_text(), result.inner_text()
    page.get_by_role("button", name="素材", exact=True).click()
    page.get_by_label("原图", exact=True).set_input_files({
        "name": "fixture.png", "mimeType": "image/png", "buffer": fixture(),
    })
    page.get_by_role("button", name="自动定位").click()
    page.get_by_label("确认文字").fill("日")
    page.get_by_label("已核实允许改作与再分发").check()
    page.get_by_role("button", name="保存确认字形").click()
    expect(page.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")
    page.get_by_role("button", name="字体", exact=True).click()
    page.get_by_label("目标文字").fill("日月")
    expect(page.get_by_text("目标覆盖 1/2")).to_be_visible()
    expect(page.get_by_text("缺字 月")).to_be_visible()
    page.get_by_label("确认私人来源允许生成和分发字体").check()
    with page.expect_download() as event:
        page.get_by_role("button", name="生成并下载字体").click()
    with ZipFile(event.value.path()) as font_package:
        data = font_package.read("CalligraCollection-Regular.ttf")
        with TTFont(BytesIO(data)) as font:
            assert set(font.getBestCmap()) == {32, ord("日")}
        assert json.loads(font_package.read("attribution.json"))["missing"] == ["月"]
        assert {"CalligraCollection-Regular.otf", "CalligraCollection-Regular.woff2"}.issubset(font_package.namelist())
    if installed_windows or verify_gdi:
        verify_windows_font(data)
    page.get_by_role("button", name="文档", exact=True).click()
    page.get_by_label("字体文件", exact=True).set_input_files({
        "name": "CalligraCollection-Regular.ttf", "mimeType": "font/ttf", "buffer": data,
    })
    for extension, create in (("docx", docx), ("odt", odt)):
        page.get_by_label("文档", exact=True).set_input_files({
            "name": f"report.{extension}", "mimeType": "application/octet-stream", "buffer": create(),
        })
        page.get_by_role("button", name="分析覆盖").click()
        expect(page.get_by_text("覆盖 1/2 字", exact=False)).to_be_visible()
        expect(page.get_by_text("缺字 月", exact=True)).to_be_visible()
        with page.expect_download() as event:
            page.get_by_role("button", name="转换并下载").click()
        with ZipFile(event.value.path()) as output:
            receipt = json.loads(output.read("analysis.json"))
            assert receipt["changed_segments"] == 2 and receipt["font_family"] == "Calligra Collection"
            document = output.read(f"Calligra.{extension}")
        with ZipFile(BytesIO(document)) as result, ZipFile(BytesIO(create())) as original:
            body = "word/document.xml" if extension == "docx" else "content.xml"
            assert set(result.namelist()) == set(original.namelist())
            assert all(result.read(part) == original.read(part) for part in original.namelist() if part != body)
            root = ET.fromstring(result.read(body))
            if extension == "docx":
                assert root.find(f".//{{{WORD}}}rFonts").get(f"{{{WORD}}}eastAsia") == "Calligra Collection"
            else:
                assert root.find(f".//{{{OFFICE}}}font-face-decls/{{{STYLE}}}font-face").get(
                    "{urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0}font-family"
                ) == "Calligra Collection"
        page.get_by_label("文档", exact=True).set_input_files({
            "name": f"reopened.{extension}", "mimeType": "application/octet-stream", "buffer": document,
        })
        page.get_by_role("button", name="分析覆盖").click()
        expect(page.get_by_text("覆盖 1/2 字", exact=False)).to_be_visible()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    url = urlsplit(args.url)
    origin = f"{url.scheme}://{url.netloc}"
    env = {key: value for key, value in os.environ.items() if key != "CALLIGRA_MANAGED_TOKEN"}
    with Popen([sys.executable, "-I", str(ROOT / "apps/api/launch_companion.py"),
                "--origin", origin, "--port", "0"], stdout=PIPE, text=True, env=env) as server:
        try:
            lines = Queue()
            Thread(target=lambda: [lines.put(line) for line in server.stdout], daemon=True).start()
            try:
                assert lines.get(timeout=15).startswith("CALLIGRA_READY ")
                code = lines.get(timeout=15).strip().removeprefix("Calligra connection code: ")
                assert len(code.split(":")[1]) == 64
            except Empty:
                raise RuntimeError("The isolated local Companion did not start") from None
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 960}, accept_downloads=True)
                page.goto(args.url)
                page.get_by_role("button", name="文档", exact=True).click()
                expect(page.get_by_label("文档", exact=True)).to_be_disabled()
                password = page.get_by_label("连接码")
                button = page.get_by_role("button", name="连接 Companion", exact=True)
                password.fill(code[:-1] + ("1" if code[-1] == "0" else "0"))
                button.click()
                expect(page.get_by_role("alert")).to_contain_text("Companion 拒绝了连接")
                password.fill(code)
                button.click()
                expect(page.get_by_text("Companion 已就绪", exact=False)).to_be_visible()
                exercise_workbench(page, verify_gdi=sys.platform == "win32")
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=8)
    print("PASS: local scan → installed Glyph → TTF/OTF/WOFF2 packaging → DOCX and ODT from the workbench")


if __name__ == "__main__":
    main()
