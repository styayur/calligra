"""Check real HarfBuzz output, source ranges and vertical placement in Chromium."""
import argparse
from base64 import b64decode
from hashlib import sha256
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def exercise(page):
    composer = page.locator(".composer")
    field = composer.get_by_label("集字内容", exact=True)
    tradition = composer.get_by_label("Tradition", exact=True)
    font = composer.get_by_label("字体", exact=True)
    tradition.select_option("Japanese")
    font.select_option("yuji-boku")
    composer.get_by_text("高级排版", exact=True).click()
    composer.get_by_label("启用 OpenType 排版", exact=True).check()
    composer.get_by_label("每行或列字数", exact=True).fill("20")
    composer.get_by_role("button", name="横排", exact=True).click()

    def save():
        with page.expect_download() as event:
            page.get_by_role("button", name="保存项目", exact=True).click()
        return json.loads(Path(event.value.path()).read_text(encoding="utf-8"))

    def compose(text, has_missing=False):
        if text is not None:
            field.fill(text)
        composer.get_by_role("button", name="生成作品", exact=True).click()
        expect(composer.locator(".feedback")).to_contain_text("已排入", timeout=60_000)
        result = save()
        assert ("缺字" in composer.locator(".feedback").inner_text()) == has_missing
        for glyph in result["glyphs"]:
            assert glyph["identity"]["text"] == glyph["character"]
            image = b64decode(glyph["asset"]["url"].split(",", 1)[1])
            assert sha256(image).hexdigest() == glyph["asset"]["checksum"]
        return result

    horizontal = compose("fi 日本")
    first = horizontal["glyphs"][0]
    assert first["character"] == "fi"
    assert first["metadata"]["font_id"] == "yuji-boku"
    assert first["metadata"]["shaping"]["font_glyph_ids"] == [460]
    runs = horizontal["composition"]["shapedRuns"]
    assert [run["text"] for run in runs] == ["fi", " ", "日本"]
    assert runs[0]["sequences"][0]["positions"][0]["cluster"] == 0
    assert runs[2]["sequences"][0]["positions"][0]["cluster"] == 3
    assert horizontal["glyphs"][1]["transform"]["x"] > first["transform"]["x"]

    composer.get_by_role("button", name="竖排", exact=True).click()
    vertical = compose("「日本12月 AI No.1 Hello」")
    by_text = {g["character"]: g for g in vertical["glyphs"]}
    for compact in ("12", "AI", "No.1"):
        glyph = by_text[compact]
        assert glyph["transform"]["rotation"] == 0
        assert glyph["metadata"]["shaping"]["direction"] == "ltr"
        assert len(glyph["metadata"]["shaping"]["font_glyph_ids"]) >= 2
    assert by_text["H"]["transform"]["rotation"] == 90
    assert by_text["日"]["metadata"]["shaping"]["direction"] == "ttb"
    assert "vert=1" in by_text["「"]["metadata"]["shaping"]["features"]
    assert "vrt2=0" in by_text["「"]["metadata"]["shaping"]["features"]

    field.fill("日本xyz")
    field.evaluate("(input) => input.setSelectionRange(2, 5)")
    composer.get_by_role("button", name="将所选文字设为纵中横", exact=True).click()
    manual = compose(None)
    assert manual["composition"]["typography"]["tcy"] == [{"start": 2, "end": 5}]
    assert manual["glyphs"][-1]["character"] == "xyz" and manual["glyphs"][-1]["transform"]["rotation"] == 0
    composer.get_by_role("button", name="撤销上一个纵中横范围", exact=True).click()
    assert [glyph["character"] for glyph in compose(None)["glyphs"]][-3:] == list("xyz")

    tradition.select_option("Korean")
    font.select_option("kr-coverage-serif")
    composer.get_by_role("button", name="横排", exact=True).click()
    ivs = "垕\U000E0102"
    unsupported = "垕\U000E01EF"
    variation = compose(f"{ivs} {unsupported} 한", has_missing=True)
    assert [glyph["character"] for glyph in variation["glyphs"]] == [ivs, "한"]
    assert variation["glyphs"][0]["identity"]["codepoints"] == ["U+5795", "U+E0102"]
    mapped = variation["glyphs"][0]["metadata"]["shaping"]["font_glyph_ids"]
    nominal = compose("垕")["glyphs"][0]["metadata"]["shaping"]["font_glyph_ids"]
    assert mapped != nominal
    page.locator('input[type=file]').set_input_files(
        {"name": "typeset.json", "mimeType": "application/json",
         "buffer": json.dumps(variation, ensure_ascii=False).encode()})
    expect(field).to_have_value(f"{ivs} {unsupported} 한")
    reloaded = save()
    assert reloaded["composition"]["shapedRuns"] == variation["composition"]["shapedRuns"]
    assert reloaded["glyphs"] == variation["glyphs"]
    return {"horizontal_ligature": first["metadata"]["shaping"], "horizontal_groups": ["12", "AI", "No.1", "xyz"],
            "variation_glyph_id": mapped, "nominal_glyph_id": nominal, "project_round_trip": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.on("dialog", lambda dialog: dialog.accept())
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="networkidle")
        evidence = exercise(page)
        assert not errors, errors
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("PASS: browser OpenType ligature, UTF-16 clusters, vertical substitution, TCY controls and exact IVS")


if __name__ == "__main__":
    main()
