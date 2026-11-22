"""Seed and export an isolated real v0.8.1 profile, then import it in a Web build."""
import argparse
from base64 import b64decode
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from migrate_windows_profile import export_profile, legacy_page
from test_extraction_browser import fixture


def database_hashes(profile):
    return {str(file.relative_to(profile)): sha256(file.read_bytes()).hexdigest()
            for file in (profile / "IndexedDB").rglob("*") if file.is_file()}


def payload(name, value):
    return {"name": name, "mimeType": "application/json",
            "buffer": json.dumps(value, ensure_ascii=False).encode()}


def exercise(executable, url, workspace):
    profile = workspace / "old-profile"
    with legacy_page(executable, profile) as legacy:
        legacy.get_by_label("集字内容").fill("明月")
        legacy.get_by_role("button", name="生成作品", exact=True).click()
        expect(legacy.locator(".composer .feedback")).to_contain_text("已排入 2 字")
        expect(legacy.get_by_text("草稿已保存到本机", exact=True)).to_be_visible()
        legacy.get_by_role("button", name="素材", exact=True).click()
        legacy.get_by_label("原图", exact=True).set_input_files(
            {"name": "legacy.png", "mimeType": "image/png", "buffer": fixture()})
        legacy.get_by_role("button", name="自动定位").click()
        legacy.get_by_label("确认文字").fill("日")
        legacy.get_by_role("button", name="保存确认字形").click()
        expect(legacy.locator("form > [role=status]")).to_contain_text("已保存 1 个确认字形")
        legacy.get_by_text("可选字库", exact=True).click()
        legacy.get_by_label("已核实分包来源与许可").check()
        snapshot_script = Path(__file__).with_name("legacy_profile_snapshot.js").read_text(encoding="utf-8")
        original = legacy.evaluate(snapshot_script)["library"]["glyphs"][0]
        packed = {**original, "source": {**original["source"], "license": "CC0-1.0"}}
        legacy.get_by_label("安装本机字库分包").set_input_files(payload("pack.json", {
            "schema_version": 1, "id": "migration-fixture", "name": "迁移测试包",
            "source": "Synthetic test fixture", "version": "1", "glyphs": [packed],
        }))
        expect(legacy.get_by_text("迁移测试包", exact=False)).to_be_visible()
        legacy.get_by_role("button", name="禁用", exact=True).click()
        expect(legacy.get_by_role("button", name="启用", exact=True)).to_be_visible()

    original_hashes = database_hashes(profile)
    output = workspace / "backup"
    assert len(export_profile(executable, profile, output)) == 2
    assert original_hashes and database_hashes(profile) == original_hashes
    library_file = output / "Calligra-private-library.json"
    saved = json.loads(library_file.read_text(encoding="utf-8"))
    assert b64decode(saved["scans"][0]["bytes"]) == fixture()
    assert not saved["packs"][0]["enabled"]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(locale="zh-CN", viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page.goto(url)
        page.locator('input[type=file]').set_input_files(output / "Calligra-legacy-project.json")
        expect(page.get_by_label("集字内容")).to_have_value("明月")
        page.get_by_role("button", name="素材", exact=True).click()
        page.get_by_text("备份与恢复个人字库", exact=True).click()
        importer = page.get_by_label("导入个人字库备份")
        importer.set_input_files(library_file)
        expect(page.get_by_text("已恢复字库备份，共 2 个字形。", exact=True)).to_be_visible()
        expect(page.get_by_text("1 个字形 · 1 个不同字", exact=True)).to_be_visible()

        # Same backup is idempotent. A conflict in a later record rolls back a valid earlier insert.
        importer.set_input_files(library_file)
        expect(page.get_by_text("已恢复字库备份，共 2 个字形。", exact=True)).to_be_visible()
        conflicting = {**saved, "glyphs": [
            {**original, "id": "private-" + "a" * 64},
            {**original, "source": {**original["source"], "work": "Conflict"}},
        ]}
        importer.set_input_files(payload("conflict.json", conflicting))
        expect(page.get_by_text("备份与现有字库存在冲突，未写入任何记录。", exact=True)).to_be_visible()
        expect(page.get_by_text("1 个字形 · 1 个不同字", exact=True)).to_be_visible()
        corrupted = {**saved, "scans": [{**saved["scans"][0], "checksum": "0" * 64}]}
        importer.set_input_files(payload("bad.json", corrupted))
        expect(page.get_by_text("个人字库备份结构、校验值或引用无效。", exact=True)).to_be_visible()

        page.get_by_text("可选字库", exact=True).click()
        expect(page.get_by_role("button", name="启用", exact=True)).to_be_visible()
        with page.expect_download() as event:
            page.get_by_role("button", name="导出个人字库备份", exact=True).click()
        restored = json.loads(Path(event.value.path()).read_text(encoding="utf-8"))
        assert saved == restored
        browser.close()
    return {"draft": "明月", "original_profile_unchanged": True, "private_glyphs": 1,
            "disabled_packs": 1, "identical_reexport": True, "conflict_rollback": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory(prefix="cg-migration-test-") as path:
        receipt = exercise(args.exe.resolve(), args.url, Path(path))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS: v0.8.1 draft, scan, glyph and disabled pack migrated with original files unchanged and import rollback")


if __name__ == "__main__":
    main()
