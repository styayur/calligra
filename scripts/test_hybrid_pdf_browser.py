"""Export real artwork and inspect the hybrid PDF object, image and Unicode layers."""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

from PIL import ImageChops
from playwright.sync_api import expect, sync_playwright
from pypdf import PdfReader
from pypdfium2 import PdfDocument


def pdf_objects(page, subtype):
    return [
        obj.get_object() for obj in page["/Resources"]["/XObject"].values()
        if obj.get_object().get("/Subtype") == subtype
    ]


def compose(page, text):
    composer = page.locator(".composer")
    composer.get_by_label("集字内容").fill(text)
    composer.get_by_role("button", name="生成作品", exact=True).click()
    expect(composer.locator(".feedback")).to_contain_text("已排入", timeout=60_000)


def save_project(page):
    with page.expect_download() as export:
        page.get_by_role("button", name="保存项目", exact=True).click()
    return json.loads(Path(export.value.path()).read_text(encoding="utf-8"))


def exercise(page, url, out):
    assert page.locator('.brand-mark img').get_attribute('src').endswith('/icons/calligra.svg')
    composer = page.locator(".composer")
    composer.get_by_label("Tradition", exact=True).select_option("Japanese")
    composer.get_by_label("字体", exact=True).select_option("yuji-boku")
    composer.get_by_text("高级排版", exact=True).click()
    composer.get_by_label("启用 OpenType 排版").check()
    composer.get_by_role("button", name="横排", exact=True).click()
    compose(page, "fi日本")
    saved = save_project(page)
    with urlopen(url + "japanese/glyphs.json", timeout=10) as source:
        historical = next(item for item in json.load(source) if item["character"] == "は")
    asset = historical["asset"]
    historical["glyph_id"] = historical["id"]
    historical["id"] = "codh-pdf-fixture"
    historical["transform"].update(x=135, y=150, scaleX=.5, scaleY=.5)
    saved["glyphs"].append(historical)
    page.locator('input[type=file]').set_input_files(
        {"name": "hybrid.json", "mimeType": "application/json", "buffer": json.dumps(saved).encode()})
    expect(page.get_by_text("项目已载入", exact=True)).to_be_visible()
    page.get_by_role("button", name="导出作品", exact=True).click()
    dialog = page.get_by_role("dialog", name="导出作品设置")
    dialog.get_by_text("PDF 纸张与输出", exact=True).click()
    dialog.get_by_label("纸张尺寸").select_option("a4")
    with page.expect_download() as export:
        dialog.get_by_role("button", name="下载 PDF", exact=True).click()
    artwork = out / "hybrid.pdf"
    export.value.save_as(artwork)
    reader = PdfReader(artwork)
    pdf_page = reader.pages[0]
    text = "".join(pdf_page.extract_text().split())
    assert all(character in text for character in ("fi", "日", "本", "は")), text
    vectors = pdf_objects(pdf_page, "/Form")
    assert len(vectors) >= 3
    assert all(b" m" in obj.get_data() and b" f" in obj.get_data().replace(b"\n", b" ") for obj in vectors)
    images = pdf_objects(pdf_page, "/Image")
    assert len(images) == 1
    assert (images[0]["/Width"], images[0]["/Height"]) == (asset["width"], asset["height"])
    assert images[0].get("/SMask")
    assert abs(float(pdf_page.mediabox.width) - 841.89) < 1 or abs(float(pdf_page.mediabox.width) - 595.28) < 1
    assert "attribution.json" in reader.attachments
    assert any("CC-BY-SA" in name for name in reader.attachments)
    layout = json.loads(reader.attachments["calligra-layout.json"][0])
    assert layout["minimumDpi"] > 0 and layout["vector"] == 3 and layout["raster"] == 1
    rendered = PdfDocument(artwork)[0].render().to_pil().convert("RGB")
    assert ImageChops.invert(rendered).getbbox()

    page.get_by_role("button", name="长卷模式", exact=True).click()
    roll = page.get_by_role("main", name="长卷模式")
    roll.get_by_label("Tradition", exact=True).select_option("Japanese")
    roll.get_by_label("字体", exact=True).select_option("yuji-boku")
    roll.get_by_label("长卷每页列数").fill("2")
    roll.get_by_label("长卷内容", exact=True).fill("日かな12月\n風月\n日本AI")
    roll.get_by_text("高级排版", exact=True).click()
    roll.get_by_label("启用 OpenType 排版").check()
    roll.get_by_role("button", name="自动生成长卷", exact=True).click()
    expect(roll.get_by_role("status")).to_contain_text("2 页", timeout=60_000)
    with page.expect_download() as export:
        roll.get_by_role("button", name="导出多页 PDF", exact=True).click()
    roll_path = out / "scroll.pdf"
    export.value.save_as(roll_path)
    scroll = PdfReader(roll_path)
    assert len(scroll.pages) == 2
    assert "12" in scroll.pages[0].extract_text() and "AI" in scroll.pages[1].extract_text()
    assert all(pdf_objects(item, "/Form") and not pdf_objects(item, "/Image") for item in scroll.pages)
    assert all("attribution.json" in item.attachments for item in (reader, scroll))
    return {"artwork_vectors": len(vectors), "historical_pixels": [asset["width"], asset["height"]],
            "effective_dpi": layout["minimumDpi"], "scroll_pages": len(scroll.pages),
            "artwork_bytes": artwork.stat().st_size, "scroll_bytes": roll_path.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    url = args.url.rstrip("/") + "/"
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(url, wait_until="networkidle")
        result = exercise(page, url, args.output)
        browser.close()
    (args.output / "receipt.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
