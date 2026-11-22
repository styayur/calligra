"""Exercise the actual Android WebView update screen against official GitHub."""
import argparse
from pathlib import Path
import re
import subprocess
import time
from xml.etree import ElementTree


def adb(*args, output=False):
    return subprocess.run(["adb", *args], check=True, capture_output=output, timeout=28).stdout


def screen():
    adb("shell", "uiautomator", "dump", "/sdcard/calligra-update.xml", output=True)
    return adb("exec-out", "cat", "/sdcard/calligra-update.xml", output=True)


def find(xml, labels, button=False):
    for node in ElementTree.fromstring(xml).iter("node"):
        if button and node.get("class") != "android.widget.Button":
            continue
        if any(node.get(key, "").strip() in labels for key in ("text", "content-desc")):
            return node
    return None


def wait_for(labels, timeout, *, button=False):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        xml = screen()
        node = find(xml, labels, button)
        if node is not None:
            return xml, node
        time.sleep(2)
    raise AssertionError(f"Android did not show the expected update status: {labels}")


def tap(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node.get("bounds", "")))
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    _, panel = wait_for({"App updates", "应用更新"}, 30, button=True)
    tap(panel)
    try:
        _, check = wait_for({"Check for updates", "检查正式更新"}, 30, button=True)
    except AssertionError:
        (args.output / "update-controls-failure.xml").write_bytes(screen())
        (args.output / "update-controls-failure.png").write_bytes(adb("exec-out", "screencap", "-p", output=True))
        raise
    tap(check)
    xml, _ = wait_for({"You have the latest stable release.", "当前已是最新正式版本。"}, 70)
    (args.output / "official-update-check.xml").write_bytes(xml)
    (args.output / "official-update-check.png").write_bytes(adb("exec-out", "screencap", "-p", output=True))
    print("PASS: installed Android WebView checked the official GitHub release and reported no newer stable build")


if __name__ == "__main__":
    main()
