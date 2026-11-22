"""Exercise restoration and editorial confirmation through the built workbench."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from test_extraction_browser import fixture


def export_project(page):
    with page.expect_download() as downloaded:
        page.get_by_role("button", name="保存项目", exact=True).click()
    return json.loads(Path(downloaded.value.path()).read_text(encoding="utf-8"))


def restore_project(page, project):
    page.locator('input[type=file]').set_input_files(
        {"name": "restored.json", "mimeType": "application/json", "buffer": json.dumps(project).encode()})
    expect(page.locator(".toolbar-status")).to_contain_text("项目已载入")


def exercise(page):
    composer = page.locator(".composer")
    mode = composer.get_by_label("集字模式", exact=True)
    expect(mode).to_have_value("mixed")

    def compose(text):
        composer.get_by_label("集字内容").fill(text)
        composer.get_by_role("button", name="生成作品", exact=True).click()
        expect(composer.locator(".feedback")).to_contain_text("已排入", timeout=60_000)
        return export_project(page)

    mixed = compose("山水 かな 한 AI")
    assert {g["source"]["writing_tradition"] for g in mixed["glyphs"]} == {"Chinese", "Japanese", "Korean"}
    mode.select_option("Chinese")
    original = "沝□旦日不可不蚤自來"
    project = compose(original)
    structure = next(g for g in project["glyphs"] if g["character"] == "沝")
    assert structure["provenance"]["type"] == "generated" and structure["metadata"]["ids"] == "⿰水水"
    assert len(structure["metadata"]["components"]) == 2
    assert all(item["sha256"] and item["source"]["license"] == "OFL-1.1" for item in structure["metadata"]["components"])
    assert not any(g["character"] == "□" for g in project["glyphs"])
    panel = composer.locator(".restoration-panel")
    panel.get_by_label("待处理位置").select_option(str(original.index("蚤")))
    panel.get_by_role("button", name="查找补字候选").click()
    loan = panel.get_by_role("listitem").filter(has_text="文献通假")
    expect(loan).to_be_visible()
    loan.get_by_role("button", name="采用字形").click()
    expect(panel.get_by_role("group", name="确认文字变更")).to_have_text("蚤 → 早确认文字变更取消")
    assert any(g["character"] == "蚤" for g in export_project(page)["glyphs"])
    panel.get_by_role("button", name="确认文字变更", exact=True).click()
    confirmed = export_project(page)
    assert confirmed["text"] == original
    assert any(g["character"] == "早" for g in confirmed["glyphs"])
    assert next(r for r in confirmed["restorations"] if r["text"] == "蚤")["decisions"][-1]["confirmed"]
    restore_project(page, confirmed)
    assert export_project(page)["restorations"] == confirmed["restorations"]

    panel.get_by_label("待处理位置").select_option("1")
    panel.get_by_label("人工补入文字").fill("明")
    panel.get_by_role("button", name="查找拟补字形").click()
    panel.get_by_role("button", name="采用字形").first.click()
    panel.get_by_role("button", name="确认文字变更", exact=True).click()
    edited = export_project(page)
    assert edited["text"] == original and any(g["character"] == "明" for g in edited["glyphs"])

    mode.select_option("Japanese")
    compose("国")
    if not panel.get_by_label("待处理位置").is_visible():
        panel.locator("summary").click()
    panel.get_by_label("待处理位置").select_option("0")
    panel.get_by_role("button", name="查找补字候选").click()
    expect(panel.get_by_role("listitem").filter(has_text="有据异体")).to_be_visible()
    panel.get_by_role("listitem").filter(has_text="有据异体").get_by_role("button", name="采用字形").click()
    panel.get_by_role("button", name="确认文字变更", exact=True).click()
    assert export_project(page)["glyphs"][0]["character"] == "國"

    mode.select_option("Korean")
    assert compose("한漢")["glyphs"][0]["source"]["writing_tradition"] == "Korean"

    def seed(character, work):
        page.get_by_role("button", name="素材", exact=True).click()
        page.get_by_label("原图", exact=True).set_input_files(
            {"name": "synthetic-selection.png", "mimeType": "image/png", "buffer": fixture()})
        page.get_by_label("传统", exact=True).select_option("Chinese")
        page.get_by_label("确认文字", exact=True).fill(character)
        source = page.get_by_text("原帖资料", exact=True)
        if not page.get_by_label("作品", exact=True).is_visible():
            source.click()
        page.get_by_label("作品", exact=True).fill(work)
        page.get_by_label("书家", exact=True).fill("Fixture Author")
        page.get_by_label("书体", exact=True).fill("行书")
        page.get_by_label("已核实允许改作与再分发").check()
        page.get_by_role("button", name="保存确认字形").click()
        expect(page.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")

    seed("霝", "Fixture Copy A")
    seed("龘", "Fixture Copy B")
    page.get_by_role("button", name="集字工作台", exact=True).click()
    mode.select_option("Chinese")
    if not composer.get_by_label("Work", exact=True).is_visible():
        composer.get_by_text("字形与跨传统探索 / Variants & exploration", exact=True).click()
    composer.get_by_label("Work", exact=True).fill("Fixture Copy A")
    composer.get_by_label("Designer", exact=True).fill("Fixture Author")
    result = compose("霝龘")
    assert [record["decisions"][-1]["kind"] for record in result["restorations"]] == ["same-work", "same-author"]
    assert all(g["provenance"]["type"] == "original" for g in result["glyphs"])
    return {"smart_mix": True, "ids": structure["metadata"]["ids"], "loan": "蚤 → 早",
            "uncertainty_preserved": True, "variant": "国 → 國", "synthetic_source_ranking": ["same-work", "same-author"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(args.url, wait_until="networkidle")
        result = exercise(page)
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
