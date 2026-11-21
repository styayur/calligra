"""Exercise new workspaces against a running local companion and Web bundle."""
import argparse
from io import BytesIO
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from fontTools.ttLib import TTFont
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
from test_document_typesetting import docx, odt
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


def exercise_workbench(page, *, installed_windows=False):
    if installed_windows:
        page.get_by_role("button", name="文档", exact=True).click()
        expect(page.get_by_label("文档", exact=True)).to_be_disabled()
        expect(page.get_by_text("首次启动会联网安装依赖。", exact=False)).to_be_visible()
        page.get_by_role("button", name="启动 Companion", exact=True).click()
        expect(page.get_by_text("Companion 已就绪", exact=False)).to_be_visible(timeout=380000)
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
    if installed_windows:
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
            assert json.loads(output.read("analysis.json"))["changed_segments"] == 2
            assert output.read(f"Calligra.{extension}").startswith(b"PK")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 900}, accept_downloads=True)
        page.route("**/*", lambda route: route.continue_() if
                   route.request.url.startswith((args.url, "http://127.0.0.1:8000/api/workbench/", "data:")) else route.abort())
        page.goto(args.url)
        exercise_workbench(page)
        browser.close()
    print("PASS: local scan → installed Glyph → TTF/OTF/WOFF2 packaging → DOCX and ODT from the workbench")


if __name__ == "__main__":
    main()
