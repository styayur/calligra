"""Render an imported layout fixture in the installed production Android WebView."""
import argparse
import json
from pathlib import Path
import time

from test_android_update_screen import adb, find, screen, tap, wait_for


PACKAGE = "io.github.styayur.calligraphystudio"
FIXTURE = "CalligraLayoutProbe.json"
TEXT = "日かな12月 AI fi"


def run(output):
    project = {
        "name": FIXTURE.removesuffix(".json"),
        "text": TEXT,
        "version": 2,
        "canvas": {"width": 1000, "height": 1200, "background": "#ffffff"},
        "glyphs": [],
        "composition": {
            "layout": "vertical-rtl", "columns": 20, "size": 160, "gap": 12, "margin": 64,
            "punctuation": True, "style": "", "source": "fonts", "textLanguage": "und",
            "policy": {"writing_tradition": "Japanese", "font_id": "yuji-boku", "mode": "strict"},
            "typography": {"mixed": False, "kinsoku": True, "automaticTcy": True,
                           "compressPunctuation": False, "tcy": [], "discretionary": False},
        },
    }
    source = output / FIXTURE
    source.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
    adb("root", output=True)
    adb("wait-for-device", output=True)
    adb("shell", "mkdir", "-p", "/sdcard/Download")
    adb("push", str(source), "/sdcard/Download/" + FIXTURE)
    adb("shell", "wm", "size", "1280x1920")
    adb("shell", "wm", "density", "160")
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
    tap(wait_for({"Project menu", "项目菜单", "Project", "项目"}, 50)[1])
    tap(wait_for({"Open project file", "载入项目文件"}, 30)[1])
    time.sleep(3)
    xml = screen()
    fixture = find(xml, {FIXTURE})
    if fixture is None:
        downloads = find(xml, {"Downloads"})
        if downloads is None:
            tap(wait_for({"Show roots", "Open from", "Show navigation drawer"}, 25)[1])
            downloads = wait_for({"Downloads"}, 25)[1]
        tap(downloads)
        fixture = wait_for({FIXTURE}, 30)[1]
    tap(fixture)
    wait_for({"Project opened", "项目已载入"}, 40)
    tap(wait_for({"Generate", "生成作品"}, 50, button=True)[1])
    deadline = time.monotonic() + 70
    while time.monotonic() < deadline:
        xml = screen()
        if any(label in xml.decode("utf-8") for label in ("Placed 7 glyphs.", "已排入 7 字。")):
            break
        if find(xml, {"Export artwork", "导出作品"}, button=True) is not None:
            export = find(xml, {"Export artwork", "导出作品"}, button=True)
            if export.get("enabled") == "true":
                break
    else:
        raise AssertionError("The installed WebView did not render the fixture")
    (output / "typesetting-native.xml").write_bytes(xml)
    (output / "typesetting-native.png").write_bytes(adb("exec-out", "screencap", "-p", output=True))
    save = find(xml, {"Save project", "保存项目"}, button=True)
    if save is None:
        tap(wait_for({"Project menu", "项目菜单", "Project", "项目"}, 25)[1])
        save = wait_for({"Download project file", "下载项目文件"}, 25)[1]
    tap(save)
    destination = f"/data/user/0/{PACKAGE}/cache/exports/{FIXTURE}"
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if b"ready" in adb("shell", f"test -s {destination} && echo ready || true", output=True):
            break
        time.sleep(1)
    rendered = adb("exec-out", "cat", destination, output=True)
    receipt = json.loads(rendered)
    assert receipt["text"] == TEXT
    assert receipt["composition"]["layout"] == "vertical-rtl"
    by_text = {glyph["character"]: glyph for glyph in receipt["glyphs"]}
    assert set(by_text) == {"日", "か", "な", "12", "月", "AI", "fi"}, by_text.keys()
    assert all(glyph["metadata"]["font_id"] == "yuji-boku" for glyph in by_text.values())
    assert by_text["12"]["transform"]["rotation"] == 0 and by_text["fi"]["transform"]["rotation"] == 90
    (output / "typesetting-native-project.json").write_bytes(rendered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        run(args.output)
    except Exception:
        (args.output / "typesetting-failure.xml").write_bytes(screen())
        (args.output / "typesetting-failure.png").write_bytes(adb("exec-out", "screencap", "-p", output=True))
        raise
    print("PASS: installed Android WebView exported real placed glyphs and original text")


if __name__ == "__main__":
    main()
