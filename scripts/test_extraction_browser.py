"""Exercise local scan review, batch import, provenance and composition."""
import argparse
from hashlib import sha256
from io import BytesIO
import json

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright


def fixture():
    image = Image.new("RGB", (160, 240), "#e9dec4")
    pen = ImageDraw.Draw(image)
    for x, y in ((104, 20), (104, 115)):
        pen.rectangle((x, y, x + 24, y + 26), fill="#211f1b")
        pen.rectangle((x + 5, y + 4, x + 18, y + 22), fill="#e9dec4")
    pen.point((12, 12), "#211f1b")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    scan = fixture()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 400, "height": 860}, accept_downloads=True)
        page.route("**/*", lambda route: route.continue_() if
                   route.request.url.startswith((args.url, "data:")) else route.abort())
        page.goto(args.url)
        page.get_by_role("button", name="素材", exact=True).click()
        page.get_by_label("原图", exact=True).set_input_files({
            "name": "synthetic-page.png", "mimeType": "image/png", "buffer": scan,
        })
        page.get_by_role("button", name="自动定位", exact=True).click()
        expect(page.locator(".scan-box")).to_have_count(2)
        expect(page.get_by_label("左 (px)")).to_have_value("104")
        expect(page.get_by_label("上 (px)")).to_have_value("20")
        expect(page.get_by_label("宽 (px)")).to_have_value("25")
        expect(page.get_by_label("高 (px)")).to_have_value("27")
        page.get_by_label("确认文字").fill("日")
        page.get_by_label("选择切框").select_option("1")
        expect(page.get_by_label("上 (px)")).to_have_value("115")
        page.get_by_label("确认文字").fill("月")
        page.get_by_role("button", name="保存确认字形").click()
        expect(page.locator("form > [role=status]")).to_contain_text("已保存 2 个确认字形")
        assert page.locator("body").evaluate("(e) => e.scrollWidth === e.clientWidth")
        page.reload()
        page.get_by_role("button", name="素材", exact=True).click()
        expect(page.locator(".private-glyphs li")).to_have_count(2)
        with page.expect_download() as original:
            page.get_by_role("button", name="原图", exact=True).first.click()
        assert original.value.path().read_bytes() == scan
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.get_by_role("button", name="集字工作台", exact=True).click()
        page.get_by_label("集字内容").fill("日月")
        page.get_by_label("字形来源").select_option("private")
        page.get_by_role("button", name="生成作品", exact=True).click()
        expect(page.locator(".composer .feedback")).to_contain_text("已排入 2 字")
        with page.expect_download() as project:
            page.get_by_role("button", name="保存项目", exact=True).click()
        glyphs = json.loads(project.value.path().read_bytes())["glyphs"]
        assert [item["character"] for item in glyphs] == ["日", "月"]
        assert all(item["source"]["source_checksum"] == sha256(scan).hexdigest() for item in glyphs)
        assert [item["metadata"]["source_bbox"]["y"] for item in glyphs] == [20, 115]
        import base64
        url = glyphs[0]["asset"]["url"]
        with Image.open(BytesIO(base64.b64decode(url.split(",")[1]))) as cropped:
            assert cropped.mode == "RGBA" and cropped.getpixel((0, 0))[3] == 0
            assert cropped.getbbox() == (8, 8, 33, 35)
        page.get_by_label("项目菜单").click()
        page.get_by_role("link", name="教程", exact=True).click()
        expect(page.get_by_role("heading", name="使用指南", exact=True)).to_be_visible()
        browser.close()
    print("PASS: two labelled scan crops, transparent ink, local reload, original bytes, composition, 400px layout and offline guide")


if __name__ == "__main__":
    main()
