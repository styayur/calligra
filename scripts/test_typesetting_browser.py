"""Check real HarfBuzz output, source ranges and vertical placement in Chromium."""
import argparse
from base64 import b64decode
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright
from PIL import Image, ImageChops


def exercise(page, gallery=None):
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
    flow = exercise_flow(page, composer, compose, gallery)
    scroll = exercise_scroll(page)
    return {"horizontal_ligature": first["metadata"]["shaping"], "horizontal_groups": ["12", "AI", "No.1", "xyz"],
            "scroll": scroll,
            "flow": flow,
            "variation_glyph_id": mapped, "nominal_glyph_id": nominal, "project_round_trip": True}

def exercise_flow(page, composer, compose, gallery):
    selection = composer.get_by_label("字形排列", exact=True)
    mode_enabled = composer.get_by_label("启用 OpenType 排版", exact=True)
    tradition = composer.get_by_label("Tradition", exact=True)
    cases = [
        ("Chinese", "行书", "山水日月山水", False),
        ("Chinese", "草书", "山水日月山水", False),
        ("Japanese", "yuji-boku", "日かな月かな 山水", True),
        ("Korean", "kr-coverage-serif", "한漢 한글", True),
    ]
    results = []
    for index, (culture, font, raw, mixed) in enumerate(cases):
        tradition.select_option(culture)
        if culture == "Chinese":
            composer.get_by_label("书体", exact=True).select_option(font)
        else:
            composer.get_by_label("字体", exact=True).select_option(font)
        for mode in ("grid", "natural", "fluent"):
            mode_enabled.set_checked(mode != "grid")
            if mode == "grid":
                composer.get_by_role("button", name="方格", exact=True).click()
            else:
                composer.get_by_role("button", name="横排", exact=True).click()
                selection.select_option(mode)
                composer.get_by_label("混合文字传统").set_checked(mixed)
            project = compose(raw if mode == "grid" else None)
            glyphs = project["glyphs"]
            assert "".join(glyph["character"] for glyph in glyphs) == raw.replace(" ", "")
            if mode != "grid":
                assert all(raw[glyph["textRange"]["start"]:glyph["textRange"]["end"]] == glyph["character"]
                           for glyph in glyphs)
                assert all(glyph["transform"]["rotation"] == 0 for glyph in glyphs)
            ids = [glyph["metadata"]["font_id"] for glyph in glyphs]
            page.get_by_role("button", name="导出作品", exact=True).click()
            with page.expect_download() as event:
                page.get_by_role("button", name="下载 PNG", exact=True).click()
            data = Path(event.value.path()).read_bytes()
            png = ZipFile(BytesIO(data)) if data.startswith(b"PK") else None
            if png:
                data = png.read(next(name for name in png.namelist() if name.endswith(".png")))
            image = Image.open(BytesIO(data)).convert("RGB")
            bounds = ImageChops.difference(image, Image.new("RGB", image.size, "white")).getbbox()
            assert bounds and 0 < bounds[0] < bounds[2] < image.width and 0 < bounds[1] < bounds[3] < image.height
            if gallery:
                gallery.mkdir(parents=True, exist_ok=True)
                (gallery / f"{index + 1}-{mode}.png").write_bytes(data)
            if page.get_by_role("dialog", name="导出作品设置").is_visible():
                page.get_by_label("关闭导出设置").click()
            gaps = [
                right["transform"]["x"] - left["transform"]["x"] - sum(
                    item["asset"]["width"] * item["transform"]["scaleX"] / 2 for item in (left, right)
                ) for left, right in zip(glyphs, glyphs[1:])
                if abs(left["transform"]["y"] - right["transform"]["y"]) < project["composition"]["size"] / 2
            ]
            if mode != "grid":
                assert not gaps or min(gaps) >= -3, (culture, mode, gaps)
            results.append({"case": culture, "requested_font_or_style": font, "text": raw, "mode": mode,
                            "font_ids": ids, "png_sha256": sha256(data).hexdigest(),
                            "ink_bounds": bounds, "horizontal_box_gaps_px": [round(gap, 2) for gap in gaps]})
    return results



def exercise_scroll(page):
    page.get_by_role("button", name="长卷模式", exact=True).click()
    scroll = page.get_by_role("main", name="长卷模式")
    scroll.get_by_label("Tradition", exact=True).select_option("Japanese")
    scroll.get_by_label("字体", exact=True).select_option("yuji-boku")
    original = "日本12月\n「かな」\nAI fi"
    scroll.get_by_label("长卷内容", exact=True).fill(original)
    scroll.get_by_label("长卷每页列数").fill("2")
    scroll.get_by_text("高级排版", exact=True).click()
    scroll.get_by_label("启用 OpenType 排版").check()
    scroll.get_by_role("button", name="自动生成长卷", exact=True).click()
    expect(scroll.get_by_role("status")).to_contain_text("2 页", timeout=60_000)
    canvas = scroll.get_by_label("长卷第 1 页")
    page.wait_for_function("""() => {
      const canvas = document.querySelector('.roll-page canvas');
      const pixels = canvas?.getContext('2d')?.getImageData(0, 0, 800, 1100).data;
      return pixels?.some((value, index) => index % 4 === 0 && value < 128);
    }""")
    with page.expect_download() as event:
        scroll.get_by_role("button", name="批量导出 ZIP", exact=True).click()
    preview = canvas.evaluate("canvas => canvas.toDataURL()")
    with ZipFile(event.value.path()) as output:
        manifest = json.loads(output.read("manifest.json"))
        assert manifest["text"] == original and not manifest["missing"], manifest
        assert len(manifest["pages"]) == 2
        slots = [slot for item in manifest["pages"] for slot in item["slots"]]
        assert all(original[slot["start"]:slot["end"]] == slot["character"] for slot in slots)
        assert all(manifest["glyphs"][slot["glyph"]]["metadata"]["font_id"] == "yuji-boku" for slot in slots)
        assert next(slot for slot in slots if slot["character"] == "12")["position"]["rotation"] == 0
        observed = Image.open(BytesIO(b64decode(preview.split(",", 1)[1]))).convert("RGB")
        exported = Image.open(BytesIO(output.read("pages/0001.png"))).convert("RGB")
        assert ImageChops.difference(observed, exported).getbbox() is None
        assert ImageChops.difference(exported, Image.new("RGB", (800, 1100), "white")).getbbox()
    return {"pages": len(manifest["pages"]), "source_ranges": len(slots), "preview_matches_png": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--gallery", type=Path)
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.on("dialog", lambda dialog: dialog.accept())
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="networkidle")
        evidence = exercise(page, args.gallery)
        assert not errors, errors
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("PASS: browser OpenType ligature, UTF-16 clusters, vertical substitution, TCY controls and exact IVS")


if __name__ == "__main__":
    main()
