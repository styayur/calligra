"""Verify Korean faces and Unicode identities against the bundled browser renderer."""
import argparse
from base64 import b64decode
from hashlib import sha256
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def exercise(page):
    composer = page.locator(".composer")
    tradition = composer.get_by_label("集字模式", exact=True)
    tradition.select_option("Korean")
    composer.get_by_role("button", name="横排", exact=True).click()
    font = composer.get_by_label("字体", exact=True)
    expect(font).to_be_enabled()
    expect(font.locator("optgroup[label=覆盖补字] option")).to_contain_text("Source Han Serif KR")

    def compose(text, status):
        composer.get_by_label("集字内容").fill(text)
        composer.get_by_role("button", name="生成作品", exact=True).click()
        expect(composer.locator(".feedback")).to_contain_text(status, timeout=60_000)
        with page.expect_download() as event:
            page.get_by_role("button", name="保存项目", exact=True).click()
        return json.loads(Path(event.value.path()).read_text(encoding="utf-8"))

    def verify(project, expected):
        assert [(g["character"], g["metadata"]["font_id"]) for g in project["glyphs"]] == expected
        receipts = []
        for glyph in project["glyphs"]:
            assert glyph["source"]["writing_tradition"] == "Korean"
            assert glyph["source"]["locale"] == "ko-KR"
            shape = glyph["metadata"]["shaping"]
            assert shape["engine"] == "harfbuzz-wasm" and shape["direction"] == "ltr"
            assert shape["source_sequence"] == glyph["identity"]["text"] == glyph["character"]
            assert all(shape["font_glyph_ids"])
            raw = b64decode(glyph["asset"]["url"].split(",", 1)[1])
            assert sha256(raw).hexdigest() == glyph["asset"]["checksum"]
            receipts.append({"text": glyph["character"], "unicode": glyph["identity"]["codepoints"],
                             "font": glyph["metadata"]["font_id"], "ids": shape["font_glyph_ids"],
                             "sha256": glyph["asset"]["checksum"]})
        return receipts

    evidence = {}
    for face in ["nanum-brush", "nanum-pen"]:
        font.select_option(face)
        evidence[face] = verify(compose("한글A漢", "缺字「漢」"), [(c, face) for c in "한글A"])
    assert evidence["nanum-brush"][0]["sha256"] != evidence["nanum-pen"][0]["sha256"]
    composer.get_by_label("缺字时允许其他韩文字体补字").check()
    evidence["explicit-hanja"] = verify(compose("한漢", "已排入 2 字"),
                                        [("한", "nanum-pen"), ("漢", "kr-coverage-serif")])
    composer.get_by_label("缺字时允许其他韩文字体补字").uncheck()
    font.select_option("")
    evidence["automatic-mixed"] = verify(compose("한漢A", "已排入 3 字"),
                                         [("한", "nanum-brush"), ("漢", "kr-coverage-serif"), ("A", "nanum-brush")])
    evidence["modern-jamo"] = verify(compose("남남", "已排入 2 字"),
                                     [("남", "nanum-brush"), ("남", "nanum-brush")])
    assert evidence["modern-jamo"][0]["ids"] == evidence["modern-jamo"][1]["ids"]
    assert evidence["modern-jamo"][1]["unicode"] == ["U+1102", "U+1161", "U+11B7"]
    font.select_option("nanum-brush")
    evidence["archaic-brush-missing"] = verify(compose("한ᄒᆞᆫ", "缺字「ᄒᆞᆫ」"), [("한", "nanum-brush")])
    font.select_option("kr-coverage-serif")
    project = compose("ᄒᆞᆫ", "已排入 1 字")
    evidence["archaic-coverage"] = verify(project, [("ᄒᆞᆫ", "kr-coverage-serif")])
    # HarfBuzz may produce a precomposed font glyph for the archaic Jamo sequence.
    assert evidence["archaic-coverage"][0]["unicode"] == ["U+1112", "U+119E", "U+11AB"]

    page.locator("input[type=file]").set_input_files(
        {"name": "korean.json", "mimeType": "application/json",
         "buffer": json.dumps(project).encode()})
    expect(page.get_by_text("项目已载入", exact=True)).to_be_visible()
    expect(font).to_have_value("kr-coverage-serif")
    tradition.select_option("Japanese")
    expect(font).to_have_value("")
    expect(font.locator("option[value=nanum-brush]")).to_have_count(0)
    tradition.select_option("Chinese")
    expect(composer.get_by_label("书体", exact=True)).to_be_enabled()
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        evidence = exercise(page)
        assert not errors, errors
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS: actual Korean glyph IDs, raster checksums, Hanja, decomposed Jamo and archaic fixture")


if __name__ == "__main__":
    main()
