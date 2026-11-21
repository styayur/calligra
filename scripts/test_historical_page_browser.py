"""Real historical page projection metrics and manual crop/reopen acceptance."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "tests/fixtures/historical-page"


def overlap(a, b):
    w = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    h = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    intersection = w * h
    return intersection / (a[2] * a[3] + b[2] * b[3] - intersection)


def exercise(browser, url, manifest):
    source = json.loads(manifest.read_text(encoding="utf-8"))
    scan = ROOT / source["image"]
    assert sha256(scan.read_bytes()).hexdigest() == source["sha256"]
    width, height = source["fixture_dimensions"]
    sx, sy = (size / original for size, original in zip(source["fixture_dimensions"], source["source_dimensions"], strict=True))
    labels = [(item["text"], [round(value * scale) for value, scale in zip(item["source_bbox"], (sx, sy, sx, sy), strict=True)])
              for item in source["labels"]]
    page = browser.new_page(viewport={"width": 1360, "height": 960}, accept_downloads=True)
    page.route("**/*", lambda route: route.continue_() if
               route.request.url.startswith((url, "data:")) else route.abort())
    page.goto(url)
    page.get_by_role("button", name="素材", exact=True).click()
    page.get_by_label("原图", exact=True).set_input_files(scan)
    expect(page.get_by_text("实验性识别建议（可选）")).to_be_visible()
    expect(page.get_by_role("button", name="实验识别待校对字")).to_have_count(0)
    page.get_by_role("button", name="自动定位").click()
    feedback = page.locator("form > [role=status]").text_content() or ""
    boxes = page.locator(".scan-box")
    proposed = boxes.evaluate_all("""(boxes) => boxes.map(box =>
        ['left','top','width','height'].map(key => parseFloat(box.style[key])))""")
    if "未找到候选切框" in feedback:
        proposed = []
    proposals = [[p / 100 * scale for p, scale in zip(box, (width, height, width, height), strict=True)] for box in proposed]
    metrics = [{"text": label, "best_iou": round(max((overlap(box, truth) for box in proposals), default=0), 4)}
               for label, truth in labels]
    expect(page.get_by_label("确认文字")).to_have_value("")
    page.reload()
    page.get_by_role("button", name="素材", exact=True).click()
    page.get_by_label("原图", exact=True).set_input_files(scan)
    page.locator(".scan-fields select").first.select_option(source.get("tradition", "Japanese"))
    for index, (label, rect) in enumerate(labels):
        if index:
            page.get_by_role("button", name="新增切框").click()
        for field, value in zip(("左 (px)", "上 (px)", "宽 (px)", "高 (px)"), rect, strict=True):
            page.get_by_label(field, exact=True).fill(str(value))
        expect(page.get_by_alt_text("原图切片")).to_be_visible()
        page.get_by_label("确认文字").fill(label)
    page.get_by_role("button", name="保存确认字形").click()
    expect(page.locator("form > [role=status]")).to_contain_text(f"已保存 {len(labels)} 个确认字形")
    page.reload()
    page.get_by_role("button", name="素材", exact=True).click()
    expect(page.locator(".private-glyphs li")).to_have_count(len(labels))
    for label, _ in labels:
        expect(page.locator(".private-glyphs").get_by_alt_text(label, exact=True)).to_have_count(1)
    with page.expect_download() as original:
        page.get_by_role("button", name="原图", exact=True).first.click()
    assert sha256(original.value.path().read_bytes()).hexdigest() == source["sha256"]
    page.close()
    return {"source": source["image_uri"], "image_sha256": source["sha256"], "labels": len(labels),
              "proposals": len(proposals), "feedback": feedback,
            "matches_at_iou_0_5": sum(m["best_iou"] >= .5 for m in metrics),
              "ground_truth_is_partial": True, "manual_reviewed_and_reopened": len(labels), "scores": metrics}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        result = [exercise(browser, args.url, ROOT / name)
                  for name in ("manifest.json", "wang-epitaph-manifest.json")]
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
