"""Install the built PWA in a clean Chromium profile and work offline."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


def exercise(context, url):
    page = context.pages[0]
    page.goto(url, wait_until="networkidle")
    page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
    cdp = context.new_cdp_session(page)
    assert cdp.send("Page.getInstallabilityErrors")["installabilityErrors"] == []
    manifest = cdp.send("Page.getAppManifest")
    assert not manifest["errors"], manifest["errors"]
    install_id = cdp.send("Page.getAppId")["appId"]
    assert install_id == url, (install_id, url)

    cache_fonts = """async () => {
      const keys = await caches.keys()
      const cache = await caches.open(keys.find((key) => key.startsWith('calligra:')))
      return (await cache.keys()).filter((key) => /[.](gzip|woff2)$/.test(key.url)).length
    }"""
    assert page.evaluate(cache_fonts) == 0
    page.get_by_role("button", name="下载离线字体", exact=True).click()
    expect(page.get_by_role("button", name="离线字体已就绪", exact=True)).to_be_disabled(timeout=180_000)
    font_count = page.evaluate(cache_fonts)
    assert font_count == page.evaluate("""async () => (await (await fetch('fonts/catalog.json')).json())
      .reduce((count, font) => count + 1 + Number(Boolean(font.opentype)), 0)""")
    cdp.send("PWA.install", {"manifestId": install_id})
    try:
        cdp.send("PWA.changeAppUserSettings", {"manifestId": install_id, "displayMode": "standalone"})
        context.set_offline(True)
        with context.expect_page() as opened:
            cdp.send("PWA.launch", {"manifestId": install_id})
        app = opened.value
        app.wait_for_load_state("domcontentloaded")
        app.wait_for_function("matchMedia('(display-mode: standalone)').matches")
        assert not app.evaluate("async () => await fetch('uncached-offline-probe').then(() => true, () => false)")
        composer = app.locator(".composer")
        composer.get_by_label("Tradition", exact=True).select_option("Korean")
        composer.get_by_label("集字内容").fill("한漢A")
        composer.get_by_role("button", name="生成作品", exact=True).click()
        expect(composer.locator(".feedback")).to_contain_text("已排入 3 字")
        expect(app.get_by_text("草稿已保存到本机", exact=True)).to_be_visible()
        app.reload()
        expect(composer.get_by_label("集字内容")).to_have_value("한漢A")
        with app.expect_download() as event:
            app.get_by_role("button", name="保存项目", exact=True).click()
        project = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
        assert [g["metadata"]["font_id"] for g in project["glyphs"]] == [
            "nanum-brush", "kr-coverage-serif", "nanum-brush",
        ]
    finally:
        context.set_offline(False)
        cdp.send("PWA.uninstall", {"manifestId": install_id})
    return {"url": url, "installed_app_id": install_id, "cached_fonts": font_count,
            "standalone_launch": True, "network_disabled": True, "draft_restore": True,
            "exported_glyphs": [g["identity"]["text"] for g in project["glyphs"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory() as profile, sync_playwright() as test:
        context = test.chromium.launch_persistent_context(profile, headless=True, channel="chromium",
                                                          locale="zh-CN", viewport={"width": 1440, "height": 960})
        try:
            receipt = exercise(context, args.url)
        finally:
            context.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS: Chromium installed and launched the PWA offline, composed, reloaded, and exported a project")


if __name__ == "__main__":
    main()
