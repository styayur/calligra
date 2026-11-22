"""Verify four locales in Chromium without changing composition or glyph policy."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


COPY = {
    "zh-CN": ("集字工作台", "界面语言", "文本语言", "Tradition", "生成作品", "字体制作", "文档排版", "碑帖提取", "长卷内容", ""),
    "ja-JP": ("集字ワークスペース", "表示言語", "本文の言語", "書の伝統", "作品を生成", "フォント制作", "文書の組版", "画像から字形を切り出す", "長巻の本文", "ja/"),
    "ko-KR": ("집자 작업실", "인터페이스 언어", "텍스트 언어", "서예 전통", "작품 만들기", "글꼴 제작", "문서 조판", "스캔에서 자형 추출", "두루마리 텍스트", "ko/"),
    "en": ("Composition Studio", "Interface language", "Text language", "Tradition", "Generate", "Font Studio", "Document typesetting", "Extract from scans", "Long scroll text", "en/"),
}
WORKSPACES = {
    "zh-CN": ("字体", "文档", "素材", "长卷模式", "项目菜单", "教程", "保存项目"),
    "ja-JP": ("フォント", "文書", "素材", "長巻", "プロジェクトメニュー", "ガイド", "プロジェクトを保存"),
    "ko-KR": ("글꼴", "문서", "소재", "두루마리", "프로젝트 메뉴", "가이드", "프로젝트 저장"),
    "en": ("Fonts", "Documents", "Materials", "Long Scroll", "Project menu", "Guide", "Save project"),
}


def exercise(page, url):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    composer = page.locator(".composer")
    language = page.locator(".ui-language select")
    expect(language).to_have_value("ja-JP")
    expect(composer.get_by_label("書の伝統", exact=True)).to_have_value("Chinese")
    composer.get_by_label("本文の言語", exact=True).select_option("en")
    composer.get_by_label("書の伝統", exact=True).select_option("Korean")
    composer.get_by_label("集字する文字", exact=True).fill("한漢A")
    composer.get_by_role("button", name="作品を生成", exact=True).click()
    expect(composer.locator(".feedback")).to_contain_text("3 字を配置しました")
    receipt = {}
    for locale, (studio, accessible, text_language, tradition, generate, fonts, documents,
                 materials, scroll, folder) in COPY.items():
        language.select_option(locale)
        expect(page.locator("html")).to_have_attribute("lang", locale)
        expect(page.get_by_label(accessible, exact=True)).to_have_value(locale)
        expect(composer.get_by_label(text_language, exact=True)).to_have_value("en")
        expect(composer.get_by_label(tradition, exact=True)).to_have_value("Korean")
        expect(composer.get_by_role("button", name=generate, exact=True)).to_be_visible()
        font_tab, doc_tab, materials_tab, scroll_tab, menu, guide, save = WORKSPACES[locale]
        top = page.locator(".mode-switch")
        top.get_by_role("button", name=font_tab, exact=True).click()
        expect(page.get_by_role("heading", name=fonts, exact=True)).to_be_visible()
        top.get_by_role("button", name=doc_tab, exact=True).click()
        expect(page.get_by_role("heading", name=documents, exact=True)).to_be_visible()
        top.get_by_role("button", name=materials_tab, exact=True).click()
        expect(page.get_by_role("heading", name=materials, exact=True)).to_be_visible()
        top.get_by_role("button", name=scroll_tab, exact=True).click()
        expect(page.get_by_label(scroll, exact=True)).to_be_visible()
        top.get_by_role("button", name=studio, exact=True).click()
        page.get_by_label(menu, exact=True).click()
        link = page.get_by_role("link", name=guide, exact=True)
        assert link.get_attribute("href").endswith("guide/" + folder + "index.html")
        help_page = page.context.new_page()
        try:
            help_page.goto(url.rstrip("/") + "/guide/" + folder + "index.html")
            expect(help_page.locator("html")).to_have_attribute("lang", locale)
            assert help_page.locator("main section").count() >= 10
        finally:
            help_page.close()
        page.get_by_label(menu, exact=True).click()
        with page.expect_download() as event:
            page.get_by_role("button", name=save, exact=True).click()
        project = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
        assert project["composition"]["textLanguage"] == "en"
        assert project["composition"]["policy"]["writing_tradition"] == "Korean"
        receipt[locale] = [g["asset"]["checksum"] for g in project["glyphs"]]
    assert len({tuple(value) for value in receipt.values()}) == 1
    page.reload()
    expect(language).to_have_value("en")
    expect(composer.get_by_label("Text language", exact=True)).to_have_value("en")
    expect(composer.get_by_label("Tradition", exact=True)).to_have_value("Korean")
    assert not errors, errors
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with sync_playwright() as test:
        browser = test.chromium.launch()
        context = browser.new_context(locale="ja-JP", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page = context.new_page()
        result = exercise(page, args.url)
        browser.close()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("PASS: four UI languages, independent text and tradition, guide, and persistence")


if __name__ == "__main__":
    main()
