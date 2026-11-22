# Calligra on a desktop browser

Open [Calligra Pages](https://styayur.github.io/calligra/) in a modern browser. Chromium browsers offer installation from the app or the browser menu. On Safari, use Add to Dock when available. The downloadable Web ZIP can be served over HTTPS or localhost. Opening index.html directly from disk cannot install a service worker.

The workbench and available built-in resources run locally after the first load. Use **Download offline fonts** while online if you need all bundled styles after going offline. Individual fonts are otherwise fetched on demand and cached after checksum verification. Projects and the personal library stay in the current browser profile and site origin. Back up both before resetting the profile or moving between copies of the app.

When a new version is ready, save your work and close all Calligra windows. The browser activates the replacement worker when the previous version has no open windows. If a browser removes cached files to reclaim space, rebuild the offline cache while online.

## Move from the v0.8.1 Windows app

1. In the old app, save each open project with **Save project** if you can. The profile exporter also recovers its current autosaved draft.
2. Close the old app fully. Keep your original installation and user data. Use its installed executable, available from the [v0.8.1 release](https://github.com/styayur/calligra/releases/tag/v0.8.1).
3. From the new release's source directory, use Python 3.12 or 3.13 and install Playwright into a virtual environment. Use the actual path to the old installed executable.

   ```powershell
   py -3.12 -m venv .migration-venv
   .\.migration-venv\Scripts\python.exe -m pip install playwright
   .\.migration-venv\Scripts\python.exe scripts\migrate_windows_profile.py --exe "C:\Path\To\Calligraphy Studio.exe" --output "C:\Path\To\New Calligra Backup"
   ```

   The default profile is `%APPDATA%\Calligraphy Studio`. Use `--profile` if your original profile is elsewhere. The output must be a new directory. The exporter opens a temporary copy of the Calligra storage in the old renderer and exports locally. It requires no browser downloads and leaves the original profile unchanged.
4. In the new workbench, open `Calligra-legacy-project.json` (or a manually saved project) via **Open project**. Under **Materials → Back up and restore personal library**, select `Calligra-private-library.json`. The library backup includes original scans, personal glyphs, optional packs and their enabled state. Import merges matching data and rolls back if an existing identity conflicts. An export containing scans larger than the 192 MiB import limit remains in your old application.
5. Confirm the project and library before removing your old app. Keep the backup files private. They may contain unpublished original material.

## Optional local Companion

The Companion is a separate Python process for TTF/OTF/WOFF2 compilation, DOCX/ODT conversion, optional PDF export, and experimental OCR. Basic composition, image exports and private-library editing run in the browser. Android can use the basic workbench without a desktop connection.

Use Python 3.12 or 3.13 with the pinned requirements from the same source release.

```powershell
py -3.12 -m venv .companion-venv
.\.companion-venv\Scripts\python.exe -m pip install -r apps/api/requirements-companion.txt
.\.companion-venv\Scripts\python.exe -I apps/api/launch_companion.py
```

```sh
python3 -m venv .companion-venv
.companion-venv/bin/python -m pip install -r apps/api/requirements-companion.txt
.companion-venv/bin/python -I apps/api/launch_companion.py
```

Paste the terminal's connection code into the Font, Document, or Materials workspace. Allow the local network prompt if your browser requests access to the local Companion. The code is scoped to the browser session. Stop the Companion with Ctrl+C, or use **Disconnect** to clear the code from the tab. A new process prints a new code. Keep the code private. For locally hosted Web ZIPs set an exact web origin such as `--origin http://127.0.0.1:8008`. The default authorized origin is the official Pages origin.

Use `--port 8766` if the default port is occupied. PDF needs a local LibreOffice executable (supply it with `--libreoffice`). Experimental OCR needs its separately installed dependencies and explicitly selected model folder (`--ocr-model-dir`). Its suggestions require manual verification. If the browser blocks access to localhost from the public site, serve the Web ZIP on localhost and authorize its exact loopback origin when starting the Companion.
