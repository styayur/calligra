"""Check actual Japanese font IDs and raster bytes in a bundled workbench."""
import argparse
from base64 import b64decode
from hashlib import sha256
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

MODERN = {
    "yuji-boku": "Yuji Boku",
    "yuji-syuku": "Yuji Syuku",
    "yuji-mai": "Yuji Mai",
    "klee-one": "Klee One",
}
HISTORICAL = {"yuji-akari": "Yuji Akari", "yuji-akebono": "Yuji Akebono"}
FALLBACK = "缺字时允许其他日文字体补字"


def exercise_font_selection(page):
    page.get_by_role("button", name="集字工作台", exact=True).click()
    composer = page.locator(".composer")
    tradition = composer.get_by_label("Tradition", exact=True)
    tradition.select_option("Chinese")
    tradition.select_option("Japanese")
    font = composer.get_by_label("字体", exact=True)
    expect(font).to_be_enabled()
    expect(font).to_have_value("")
    expect(font.locator("option:checked")).to_have_text("自动选择")
    expect(font.locator("optgroup[label=历史假名] option")).to_have_count(2)
    expect(font.locator("optgroup[label=覆盖补字] option")).to_contain_text("JP Coverage Serif")

    def save():
        with page.expect_download(timeout=60000) as event:
            page.get_by_role("button", name="保存项目", exact=True).click()
        return json.loads(Path(event.value.path()).read_text(encoding="utf-8"))

    def compose(text, status):
        composer.get_by_label("集字内容").fill(text)
        composer.get_by_role("button", name="生成作品", exact=True).click()
        expect(composer.locator(".feedback")).to_contain_text(status, timeout=120000)
        return save()

    def validate_fonts(project, inputs, ids, direction="ttb"):
        glyphs = project["glyphs"]
        assert [g["character"] for g in glyphs] == list(inputs)
        assert [g["metadata"]["font_id"] for g in glyphs] == ids
        for glyph in glyphs:
            assert glyph["source"]["writing_tradition"] == "Japanese"
            assert glyph["source"]["locale"] == "ja-JP"
            shaping = glyph["metadata"]["shaping"]
            assert shaping["engine"] == "harfbuzz-wasm" and shaping["direction"] == direction
            raw = b64decode(glyph["asset"]["url"].split(",", 1)[1])
            assert sha256(raw).hexdigest() == glyph["asset"]["checksum"]
        return [g["asset"]["checksum"] for g in glyphs]

    def reopen(project):
        page.locator('input[type=file]').set_input_files({
            "name": "round-trip.json", "mimeType": "application/json",
            "buffer": json.dumps(project).encode(),
        })

    evidence = {}
    for font_id, family in MODERN.items():
        font.select_option(font_id)
        expect(font.locator("option:checked")).to_have_text(family)
        project = compose("骨あカ", "已排入 3 字")
        assert project["composition"]["policy"]["font_id"] == font_id
        evidence[font_id] = validate_fonts(project, "骨あカ", [font_id] * 3)
    assert len({tuple(glyphs) for glyphs in evidence.values()}) == len(MODERN)

    # Restore an actual selected family before composing again. A v0.8.0 project
    # had the same schema, but carried no font preference.
    reopen(project)
    expect(font).to_have_value("klee-one")
    assert save()["glyphs"] == project["glyphs"]
    legacy = {**project, "composition": {**project["composition"],
              "policy": {"writing_tradition": "Japanese", "locale": "ja-JP", "mode": "strict"}}}
    reopen(legacy)
    expect(font).to_have_value("")
    assert save()["glyphs"] == legacy["glyphs"]
    automatic = compose("あ㐆", "缺字「㐆」")
    assert [g["character"] for g in automatic["glyphs"]] == ["あ"]
    assert automatic["glyphs"][0]["metadata"]["font_id"] in MODERN
    assert automatic["glyphs"][0]["variant"]["type"] != "hentaigana"

    font.select_option("yuji-boku")
    expect(composer.get_by_label(FALLBACK)).not_to_be_checked()
    strict = compose("骨㐆", "缺字「㐆」")
    validate_fonts(strict, "骨", ["yuji-boku"])
    composer.get_by_label(FALLBACK).check()
    fallback = compose("骨㐆", "已排入 2 字")
    evidence["explicit-fallback"] = validate_fonts(fallback, "骨㐆", ["yuji-boku", "jp-coverage-serif"])
    assert fallback["composition"]["policy"]["allow_font_fallback"] is True
    reopen(fallback)
    expect(font).to_have_value("yuji-boku")
    expect(composer.get_by_label(FALLBACK)).to_be_checked()
    composer.get_by_label(FALLBACK).uncheck()

    font.select_option("jp-coverage-serif")
    coverage = compose("㐆", "已排入 1 字")
    evidence["jp-coverage-serif"] = validate_fonts(coverage, "㐆", ["jp-coverage-serif"])
    assert coverage["glyphs"][0]["source"]["source_role"] == "coverage-fallback"
    for font_id, family in HISTORICAL.items():
        font.select_option(font_id)
        expect(font.locator("option:checked")).to_have_text(f"{family}（历史假名）")
        historical = compose("あ", "已排入 1 字")
        assert historical["glyphs"][0]["variant"]["type"] == "hentaigana"
        evidence[font_id] = validate_fonts(historical, "あ", [font_id])
    assert evidence["yuji-akari"] != evidence["yuji-akebono"]

    font.select_option("yuji-boku")
    composer.locator("summary").filter(has_text="间距与留白").click()
    composer.get_by_label("保留标点").check()
    vertical = compose("骨あ、。", "已排入 4 字")
    vertical_hashes = validate_fonts(vertical, "骨あ、。", ["yuji-boku"] * 4)
    composer.get_by_role("button", name="横排", exact=True).click()
    horizontal = compose("骨あ、。", "已排入 4 字")
    horizontal_hashes = validate_fonts(horizontal, "骨あ、。", ["yuji-boku"] * 4, "ltr")
    assert vertical_hashes[2:] != horizontal_hashes[2:]

    page.get_by_role("button", name="查字", exact=True).click()
    search = page.locator(".glyph-browser")
    search.get_by_label("搜索字形").fill("骨")
    expect(search.get_by_label("字体", exact=True)).to_have_value("yuji-boku")
    expect(search.locator(".glyph-card")).to_have_count(1)
    expect(search.locator(".glyph-card")).to_contain_text("Yuji Boku")
    search.get_by_label("字体", exact=True).select_option("yuji-mai")
    expect(search.locator(".glyph-card")).to_have_count(1)
    expect(search.locator(".glyph-card")).to_contain_text("Yuji Mai")
    search.get_by_label("Tradition", exact=True).select_option("Chinese")
    search.get_by_label("书体", exact=True).select_option("草书")
    search.get_by_label("字库来源").select_option("OFL Calligraphy Fonts")
    search.get_by_label("Tradition", exact=True).select_option("Japanese")
    expect(search.get_by_label("字库来源")).to_have_value("")
    expect(search.locator(".glyph-card").first).to_be_visible()

    page.get_by_role("button", name="集字", exact=True).click()
    page.get_by_role("button", name="选择第2字あ", exact=True).click()
    inspector = page.locator(".inspector")
    expect(inspector.get_by_label("字体", exact=True)).to_have_value("yuji-boku")
    expect(inspector.locator(".variant-grid button")).to_have_count(1)
    inspector.get_by_label("字体", exact=True).select_option("yuji-mai")
    inspector.get_by_role("button", name="替换为Yuji Mai", exact=True).click()
    replaced = save()
    assert replaced["glyphs"][1]["metadata"]["font_id"] == "yuji-mai"
    assert replaced["glyphs"][1]["metadata"]["shaping"]["direction"] == "ltr"
    assert replaced["glyphs"][1]["asset"]["checksum"] != horizontal_hashes[1]
    assert replaced["composition"]["policy"]["font_id"] == "yuji-boku"
    page.get_by_label("关闭字形调整").click()

    tradition.select_option("Chinese")
    style = composer.get_by_label("书体", exact=True)
    for label in ("楷书", "行书", "草书"):
        style.select_option(label)
        chinese = compose("山水", "已排入 2 字")
        assert all(g["source"]["style"] == label and g["source"]["writing_tradition"] == "Chinese"
                   for g in chinese["glyphs"])
        assert not chinese["composition"]["policy"].get("font_id")
    tradition.select_option("Japanese")
    expect(font).to_have_value("")
    expect(composer.get_by_label(FALLBACK)).not_to_be_checked()
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 960}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.route("**/*", lambda route: route.continue_() if
                   route.request.url.startswith((args.url, "data:")) else route.abort())
        page.goto(args.url)
        evidence = exercise_font_selection(page)
        if args.screenshot:
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.locator(".composer").get_by_label("字体", exact=True).select_option("yuji-boku")
            page.locator(".composer").get_by_label("集字内容").fill("骨あカ")
            page.get_by_role("button", name="生成作品", exact=True).click()
            expect(page.locator(".composer .feedback")).to_contain_text("已排入 3 字")
            page.screenshot(path=args.screenshot)
        assert not errors, errors
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"PASS: Japanese family and raster receipts {json.dumps(evidence)}")


if __name__ == "__main__":
    main()
