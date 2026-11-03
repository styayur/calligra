# Dependency repair — 3 November 2026

This supersedes the exception policy described in the dated 0.7.0 audit. Raw full-tree npm audit reports zero advisories for both web and desktop, and the production web tree is also zero. The gate now rejects every finding in all three trees with no exceptions. Historical failed audits remain in the account closeout record; a local successful audit alone does not establish packaged/native acceptance.

The security branch updates Brotli to 1.2.1, Electron to 44.9.1, electron-builder to 26.18.0, Undici to 7.30.1 (with the compatible nested 6.29.1 chain), and fast-uri to 3.1.9. Electron remains unsigned in candidate CI; no production signing identity or formal release is used.

## Legacy matcher compatibility

Four build consumers (`@electron/asar`, `dir-compare`, glob 7 and `filelist`) require a callable CommonJS matcher. Directly replacing that API with minimatch 11's namespace breaks the build. `third_party/legacy-matcher` therefore contains project-owned API glue with its own name/version, exact source archive and original project GPL license. Its dependency is the real fixed `minimatch@11.0.1`, explicitly aliased as `minimatch-modern`. No old parser implementation is copied or assigned a fake patched version. Modern electron-builder/universal callers use upstream 11.0.1 directly.

The fixed engine uses nonrecursive Matcher objects; legacy glob also needs `_glob` metadata and `String.match`. Proxy views provide those protocols without altering shared cached Matchers. Expanded rows remain separate, and pattern parsing, brace bounds and matching remain in the fixed engine. The root npm key `minimatch` explicitly points to the local adapter; its real name/version remain visible in package-lock and installed metadata. Regenerating the old dependency layout required a clean lock resolution, followed by normal clean `npm ci`, with no force or peer overrides.

Checks include 2,640 differential boolean cases against old 3.1.5/5.1.9, 15 filesystem patterns, positive recursive/Unicode/dotfile results, bounded adversarial braces, real ASAR packing/native unpack paths, dir-compare content filters and filelist exclusions. Original filelist 1.0.6 has a Windows recursive-pattern limitation: normalized backslashes cause `**/*.txt` to return no matches in both the original and adapted trees. That is not claimed fixed; root-pattern positive checks and actual installer gates exercise the relevant build paths.

The local archive must exactly equal the source/manifest/license/README bytes checked into the repository. Git attributes preserve those bytes on Windows and Linux. The package is not published to npm and does not enter the renderer bundle.

## Glob cancellation

The [upstream advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) affects glob 9 through 14.0.1. Capacitor's rimraf chain is scoped to patched 14.0.3, which retains the documented named APIs and Node 18/20/22 engine support. The actual installed dependency test verifies positive recursive results, no further directory reads after abort, and confined deletion of synthetic fixture files with unaffected siblings retained. Windows glob patterns use documented forward slashes.

## Required integration acceptance

Keep the API tests/security audit, type checks, deterministic visual tests, browser composition/export/cancellation regressions, Android candidate validation and Windows installer/portable builds. Windows CI additionally launches the actual packaged renderer in isolated synthetic profiles. These gates must all pass for this exact branch head before it can be merged. A formal release, signed installer publication and physical Android acceptance are separate actions.
