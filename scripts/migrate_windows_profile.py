"""Export a closed v0.8.1 Windows profile to local project and private-library backups.

Supply the installed Calligraphy Studio.exe and its data directory. The tool loads
a temporary copy of the app://bundle IndexedDB files and writes to a new directory.
"""
import argparse
from contextlib import contextmanager, ExitStack
import json
import os
from pathlib import Path
import shutil
from subprocess import CREATE_NO_WINDOW, DEVNULL, Popen
from tempfile import TemporaryDirectory
import time

from playwright.sync_api import sync_playwright

ORIGIN = "app://bundle"
LIMIT = 192 * 1024 * 1024


@contextmanager
def legacy_page(executable, profile):
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "false"
    command = [str(executable), "--release-smoke-test", "--remote-debugging-port=0",
               "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + str(profile)]
    with Popen(command, creationflags=CREATE_NO_WINDOW, env=env, stdout=DEVNULL, stderr=DEVNULL) as process:
        try:
            deadline = time.monotonic() + 20
            active_port = profile / "DevToolsActivePort"
            while not active_port.is_file() and time.monotonic() < deadline and process.poll() is None:
                time.sleep(0.1)
            if not active_port.is_file():
                raise RuntimeError("The isolated Calligraphy Studio v0.8.1 renderer could not start.")
            port, socket_path = active_port.read_text(encoding="utf-8").splitlines()[:2]
            if not port.isdecimal() or not socket_path.startswith("/devtools/browser/"):
                raise RuntimeError("Unexpected debugging endpoint for the isolated renderer.")
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp("ws://127.0.0.1:" + port + socket_path, timeout=15_000)
                context = browser.contexts[0]
                page = context.pages[0] if context.pages else context.wait_for_event("page", timeout=15_000)
                page.wait_for_url(ORIGIN + "/index.html", timeout=15_000)
                page.route("https://**", lambda route: route.abort())
                page.route("http://**", lambda route: route.abort())
                yield page
                browser.close()
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=15)


def copy_origin_database(source, target):
    import msvcrt

    source_db = source / "IndexedDB"
    directories = sorted(p for p in source_db.glob("app_bundle_*") if p.is_dir())
    if not directories or not any(path.name.endswith(".leveldb") for path in directories):
        raise ValueError("No app://bundle IndexedDB profile was found at that location.")
    for path in directories:
        if path.is_symlink() or path.is_junction() or any(
                entry.is_symlink() or entry.is_junction() for entry in path.rglob("*")):
            raise ValueError("The app database contains a link or junction.")
    with ExitStack() as locks:
        for folder in directories:
            if not folder.name.endswith(".leveldb"):
                continue
            lock = locks.enter_context((folder / "LOCK").open("rb"))
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ValueError("Close the old Windows app before exporting its database.") from error
        (target / "IndexedDB").mkdir(parents=True)
        for path in directories:
            shutil.copytree(path, target / "IndexedDB" / path.name, ignore=shutil.ignore_patterns("LOCK"))


def export_profile(executable, source, output):
    output = output.resolve()
    if output.exists():
        raise FileExistsError("Choose a new output directory.")
    if output.is_relative_to(source):
        raise ValueError("Keep the existing profile and exported files in separate folders.")
    with TemporaryDirectory(prefix="calligra-migration-") as temporary:
        workspace = Path(temporary)
        profile = workspace / "profile"
        copy_origin_database(source, profile)
        with legacy_page(executable, profile) as page:
            reader = Path(__file__).with_name("legacy_profile_snapshot.js").read_text(encoding="utf-8")
            snapshot = page.evaluate(reader)
        payloads = {}
        if snapshot.get("draft"):
            draft = snapshot["draft"]
            payloads["Calligra-legacy-project.json"] = {**draft["document"], "name": draft["name"]}
        if snapshot.get("library"):
            payloads["Calligra-private-library.json"] = snapshot["library"]
        if not payloads:
            raise ValueError("The selected old profile contains no saved draft or private-library database.")
        output.parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix=".calligra-export-", dir=output.parent) as stage:
            stage_dir = Path(stage) / "export"
            stage_dir.mkdir()
            for name, value in payloads.items():
                data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                limit = LIMIT if name.endswith("library.json") else 40 * 1024 * 1024
                if len(data) > limit:
                    raise ValueError(f"The {name} file exceeds the import size limit.")
                (stage_dir / name).write_bytes(data)
            stage_dir.rename(output)
    return list(payloads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True, help="Installed Calligraphy Studio v0.8.1 executable")
    parser.add_argument("--profile", type=Path, default=Path(os.environ.get("APPDATA", ".")) / "Calligraphy Studio")
    parser.add_argument("--output", type=Path, required=True, help="New local output directory")
    args = parser.parse_args()
    if not args.exe.is_file() or not args.profile.is_dir():
        parser.error("Select the existing v0.8.1 executable and application data directory.")
    try:
        for name in export_profile(args.exe.resolve(), args.profile.resolve(), args.output):
            print("Exported " + name)
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Migration did not complete. Original data is unchanged. {error}\n")


if __name__ == "__main__":
    main()
