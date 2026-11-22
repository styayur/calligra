"""Check real HarfBuzz output, source ranges and vertical placement in Chromium."""
import argparse
from base64 import b64decode
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright
from PIL import Image, ImageChops, ImageDraw


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
    tradition.select_option("Japanese")
    font.select_option("yuji-boku")
    composer.get_by_role("button", name="竖排", exact=True).click()
    composer.get_by_label("每行或列字数", exact=True).fill("20")
    composer.get_by_label("混合文字传统").check()
    field.fill("山水 かな 한漢 AI")
    field.evaluate("(field) => field.setSelectionRange(0, 2)")
    composer.get_by_label("所选文字的语言").select_option("zh")
    composer.get_by_role("button", name="为所选文字指定语言").click()
    mixed = compose(None)
    assert mixed["composition"]["typography"]["spans"] == [
        {"start": 0, "end": 2, "language": "zh", "tradition": "Chinese"},
    ]
    assert [glyph["source"]["writing_tradition"] for glyph in mixed["glyphs"][:5]] == [
        "Chinese", "Chinese", "Japanese", "Japanese", "Korean",
    ]
    assert next(glyph for glyph in mixed["glyphs"] if glyph["character"] == "AI")["transform"]["rotation"] == 0
    flow = exercise_flow(page, composer, compose, gallery)
    reviewed_group = exercise_reviewed_group(page, composer, compose)
    scroll = exercise_scroll(page)
    return {"horizontal_ligature": first["metadata"]["shaping"], "horizontal_groups": ["12", "AI", "No.1", "xyz"],
            "scroll": scroll,
            "flow": flow,
            "mixed_languages": [run["language"] for run in mixed["composition"]["shapedRuns"]],
            "reviewed_group": reviewed_group,
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
        ("Japanese", "", "風かな月かな日", False),
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
            if index == 0 and mode == "fluent":
                page.get_by_role("button", name="选择第1字山", exact=True).click()
                composer.get_by_role("button", name="固定所选字形", exact=True).click()
                pinned = compose(None)
                assert pinned["composition"]["typography"]["flow"]["pins"] == [
                    {"start": 0, "end": 1, "glyphId": glyphs[0]["metadata"]["font_id"]},
                ]
                assert pinned["glyphs"][0]["glyph_id"] == glyphs[0]["glyph_id"]
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
                            "flow_line_costs": project["composition"].get("flowCosts", []),
                            "font_ids": ids, "png_sha256": sha256(data).hexdigest(),
                            "ink_bounds": bounds, "horizontal_box_gaps_px": [round(gap, 2) for gap in gaps]})
    assert all(item["flow_line_costs"] for item in results if item["mode"] == "fluent")
    return results


def exercise_reviewed_group(page, composer, compose):
    scan = Image.new("RGB", (80, 120), "white")
    draw = ImageDraw.Draw(scan)
    draw.line([(15, 10), (50, 30), (20, 45), (57, 80), (22, 105)], fill="black", width=4)
    original = BytesIO()
    scan.save(original, format="PNG")
    page.get_by_role("button", name="素材", exact=True).click()
    page.get_by_label("原图", exact=True).set_input_files(
        {"name": "synthetic-group-test.png", "mimeType": "image/png", "buffer": original.getvalue()})
    page.get_by_label("传统", exact=True).select_option("Japanese")
    page.get_by_label("同一原图切框内的连绵假名").check()
    page.get_by_label("确认文字", exact=True).fill("あい")
    page.get_by_role("button", name="保存确认字形").click()
    expect(page.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")
    page.get_by_role("button", name="集字工作台", exact=True).click()
    composer.get_by_label("Tradition", exact=True).select_option("Japanese")
    composer.get_by_label("字形来源", exact=True).select_option("private")
    composer.get_by_label("启用 OpenType 排版", exact=True).check()
    composer.get_by_label("使用已校对的原帖连绵假名（个人字库或全部来源）").check()
    project = compose("あい")
    assert len(project["glyphs"]) == 1
    glyph = project["glyphs"][0]
    assert glyph["textRange"] == {"start": 0, "end": 2}
    assert glyph["character"] == "あい" and glyph["provenance"]["type"] == "original"
    assert glyph["source"]["source_checksum"] == sha256(original.getvalue()).hexdigest()
    assert glyph["metadata"]["original_group"]["region"] == {"x": 0, "y": 0, "width": 80, "height": 120}
    assert not glyph["source"]["rights"]["redistribution_allowed"]
    return {"synthetic_UI_fixture": True, "range": glyph["textRange"], "confirmed_text": glyph["character"]}



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


def compare_native(page, path):
    native = json.loads(path.read_text(encoding="utf-8"))
    fixture = {**native, "glyphs": []}
    page.locator('input[type=file]').set_input_files(
        {"name": "native-source.json", "mimeType": "application/json",
         "buffer": json.dumps(fixture, ensure_ascii=False).encode()})
    composer = page.locator(".composer")
    composer.get_by_role("button", name="生成作品", exact=True).click()
    expect(composer.locator(".feedback")).to_contain_text("已排入 7 字", timeout=60_000)
    with page.expect_download() as event:
        page.get_by_role("button", name="保存项目", exact=True).click()
    web = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
    assert native["text"] == web["text"]
    assert native["composition"]["shapedRuns"] == web["composition"]["shapedRuns"]
    assert len(native["glyphs"]) == len(web["glyphs"]) == 7
    for android, chromium in zip(native["glyphs"], web["glyphs"], strict=True):
        assert android["textRange"] == chromium["textRange"] and android["identity"] == chromium["identity"]
        assert android["metadata"]["font_id"] == chromium["metadata"]["font_id"]
        assert android["asset"]["bbox"] == chromium["asset"]["bbox"]
        for key in ("x", "y", "scaleX", "scaleY", "rotation"):
            assert abs(android["transform"][key] - chromium["transform"][key]) <= .05
    return {"glyphs": 7, "position_tolerance_px": .05, "open_type_metrics_equal": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--gallery", type=Path)
    parser.add_argument("--native-project", type=Path)
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.on("dialog", lambda dialog: dialog.accept())
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="networkidle")
        native = compare_native(page, args.native_project) if args.native_project else None
        if native:
            page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
            page.on("dialog", lambda dialog: dialog.accept())
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
        evidence = exercise(page, args.gallery)
        if native:
            evidence["native_webview_comparison"] = native
        assert not errors, errors
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("PASS: browser OpenType ligature, UTF-16 clusters, vertical substitution, TCY controls and exact IVS")


if __name__ == "__main__":
    main()
