"""Exercise the Windows browser PWA against the published migration baseline."""
from hashlib import sha256
from pathlib import Path
from subprocess import CREATE_NO_WINDOW, DEVNULL, Popen, list2cmdline, run
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from urllib.error import URLError
from urllib.request import urlopen

INSTALLER = "CalligraphyStudio-Setup-0.8.1-x64.exe"
HASH = "510807622c29d09e21f0cb34f95899f8ce84481496e1a6cd657ceb7e1c273bee"
URL = "http://127.0.0.1:5181/"


def main():
    with TemporaryDirectory(prefix="cg-platform-") as temp:
        folder = Path(temp)
        run(["gh", "release", "download", "v0.8.1", "--repo", "styayur/calligra",
             "--dir", temp, "--pattern", INSTALLER], check=True, timeout=120)
        installer = folder / INSTALLER
        assert sha256(installer.read_bytes()).hexdigest() == HASH, "Historical installer checksum mismatch"
        destination = folder / "app"
        command = list2cmdline([str(installer), "/S"]) + f" /D={destination}"
        run(command, executable=str(installer), check=True, timeout=240, creationflags=CREATE_NO_WINDOW)
        executable = destination / "Calligraphy Studio.exe"
        assert executable.is_file(), "Historical Windows installer failed"
        with Popen([sys.executable, "-m", "http.server", "5181", "--bind", "127.0.0.1", "--directory", "apps/web/dist"],
                   stdout=DEVNULL, stderr=DEVNULL, creationflags=CREATE_NO_WINDOW) as server:
            try:
                deadline = monotonic() + 15
                while True:
                    try:
                        with urlopen(URL, timeout=2) as response:
                            assert response.status == 200
                        break
                    except URLError:
                        if monotonic() >= deadline or server.poll() is not None:
                            raise
                        sleep(0.15)
                run([sys.executable, "scripts/test_pwa_browser.py", "--url", URL,
                     "--output", "work/pwa-windows.json"], check=True, timeout=240)
                run([sys.executable, "scripts/test_local_workbench_browser.py", "--url", URL], check=True, timeout=240)
                run([sys.executable, "scripts/test_windows_migration.py", "--exe", str(executable),
                     "--url", URL, "--output", "work/windows-migration.json"], check=True, timeout=240)
            finally:
                server.terminate()
                server.wait(timeout=10)


if __name__ == "__main__":
    main()
