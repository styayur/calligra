"""Exercise new workspaces against a running local companion and Web bundle."""
import argparse
from io import BytesIO
import json
from queue import Empty, Queue
from subprocess import DEVNULL, PIPE, Popen, run
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
from document_fixtures import docx, odt, OFFICE, STYLE, WORD
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


def exercise_workbench(page, *, verify_gdi=False):
    page.get_by_role("button", name="素材", exact=True).click()
    page.get_by_label("原图", exact=True).set_input_files({
        "name": "fixture.png", "mimeType": "image/png", "buffer": fixture(),
    })
    page.get_by_role("button", name="自动定位").click()
    page.get_by_label("确认文字").fill("日")
    page.get_by_label("已核实允许改作与再分发").check()
    page.get_by_role("button", name="保存确认字形").click()
    expect(page.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")
    page.get_by_role("button", name="集字工作台", exact=True).click()
    page.get_by_label("项目名称").fill("Collection")
    composer = page.locator(".composer")
    composer.get_by_label("字形来源").select_option("private")
    composer.get_by_label("集字内容").fill("日月")
    composer.get_by_role("button", name="生成作品", exact=True).click()
    expect(composer.locator(".feedback")).to_contain_text("已排入")
    page.get_by_label("项目菜单").click()
    page.get_by_role("button", name="从作品制作字体", exact=True).click()
    expect(page.get_by_label("目标文字")).to_have_value("日月")
    expect(page.get_by_text("目标覆盖 1/2")).to_be_visible()
    expect(page.get_by_text("缺字 月")).to_be_visible()
    page.get_by_label("确认私人来源允许生成和分发字体").check()
    page.get_by_text("筛选字形与高级格式", exact=True).click()
    page.get_by_label("OTF", exact=True).check()
    page.get_by_label("WOFF2", exact=True).check()
    with page.expect_download() as event:
        page.get_by_role("button", name="生成并下载字体").click()
    with ZipFile(event.value.path()) as font_package:
        data = font_package.read("CalligraCollection-Regular.ttf")
        with TTFont(BytesIO(data)) as font:
            assert set(font.getBestCmap()) == {32, ord("日")}
        assert json.loads(font_package.read("attribution.json"))["missing"] == ["月"]
        assert {"CalligraCollection-Regular.otf", "CalligraCollection-Regular.woff2"}.issubset(font_package.namelist())
    if verify_gdi:
        verify_windows_font(data)
    expect(page.get_by_label("已生成字体预览")).to_be_visible()
    page.get_by_role("button", name="在文档中使用此字体").click()
    page.get_by_text("文档替换范围与高级选项", exact=True).click()
    page.get_by_label("仅汉字").check()
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

    page.get_by_label("书法字体").select_option("ma-shan-zheng")
    page.get_by_label("替换范围").select_option("body")
    page.get_by_label("文档", exact=True).set_input_files({
        "name": "bundled.docx", "mimeType": "application/octet-stream", "buffer": docx(),
    })
    page.get_by_role("button", name="分析覆盖").click()
    expect(page.get_by_role("button", name="转换并下载")).to_be_enabled()
    with page.expect_download() as event:
        page.get_by_role("button", name="转换并下载").click()
    with ZipFile(event.value.path()) as result:
        analysis = json.loads(result.read("analysis.json"))
        assert analysis["font_family"] == "Ma Shan Zheng" and analysis["selected_paragraphs"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--windows-launcher", action="store_true")
    args = parser.parse_args()
    url = urlsplit(args.url)
    origin = f"{url.scheme}://{url.netloc}"
    command = (["pwsh", "-NoProfile", "-File", str(ROOT / "scripts/start_companion.ps1")]
               if args.windows_launcher else [sys.executable, "-I", str(ROOT / "apps/api/launch_companion.py")])
    with Popen([*command, "--origin", origin, "--port", "0"], stdout=PIPE, text=True) as server:
        try:
            lines = Queue()
            Thread(target=lambda: [lines.put(line) for line in server.stdout], daemon=True).start()
            try:
                while not lines.get(timeout=90 if args.windows_launcher else 15).startswith("CALLIGRA_READY "):
                    assert server.poll() is None, "The local Companion launcher exited during setup"
                code = lines.get(timeout=15).strip().removeprefix("Calligra connection code: ")
                assert len(code.split(":")[1]) == 64
            except Empty:
                raise RuntimeError("The isolated local Companion did not start") from None
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 960}, accept_downloads=True)
                page.goto(args.url)
                page.get_by_role("button", name="文档", exact=True).click()
                expect(page.get_by_role("button", name="分析覆盖")).to_be_disabled()
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
            if args.windows_launcher and server.poll() is None:
                run(["taskkill", "/PID", str(server.pid), "/T", "/F"], stdout=DEVNULL, check=True)
            elif server.poll() is None:
                server.terminate()
            server.wait(timeout=8)
    print("PASS: local scan, installed glyph, TTF/OTF/WOFF2 packaging, and DOCX and ODT conversion")


if __name__ == "__main__":
    main()
