#!/usr/bin/env bash
# Verify an in-place upgrade from the previous public production APK.
set -euo pipefail

package=io.github.styayur.calligraphystudio
baseline=work/android-baseline/CalligraphyStudio-Android-0.10.0.apk
candidate=apps/web/android/app/build/outputs/apk/release/app-release.apk
evidence=work/android-upgrade
mkdir -p "$evidence"
adb shell getprop ro.build.version.sdk > "$evidence/android-api.txt"

launch() {
  local generation=$1
  adb logcat -c
  adb shell am start -W -n "$package/.MainActivity" | tee "$evidence/$generation-launch.txt"
  grep -q '^Status: ok' "$evidence/$generation-launch.txt"
  # Android may report the activity launched while its WebView restores the
  # workspace. Inspect the actual editor before recording the candidate.
  local attempt
  for attempt in {1..12}; do
    adb shell uiautomator dump /sdcard/calligra-upgrade.xml
    adb pull /sdcard/calligra-upgrade.xml "$evidence/$generation-screen.xml"
    if [[ "$generation" == baseline ]] || grep -Eq '集字内容|生成作品|Composition text|Generate' "$evidence/$generation-screen.xml"; then
      break
    fi
    sleep 2
  done
  grep -q "package=\"$package\"" "$evidence/$generation-screen.xml"
  if [[ "$generation" == candidate ]]; then
    grep -Eq '集字内容|生成作品|Composition text|Generate' "$evidence/$generation-screen.xml"
  fi
  adb exec-out screencap -p > "$evidence/$generation-screen.png"
  local pid
  pid=$(adb shell pidof -s "$package" | tr -d '\r')
  test -n "$pid"
  adb logcat -d --pid="$pid" 'AndroidRuntime:E' '*:S' > "$evidence/$generation-crashes.txt"
  ! grep -q 'FATAL EXCEPTION' "$evidence/$generation-crashes.txt"
}

adb install "$baseline" | tee "$evidence/baseline-install.txt"
launch baseline
adb shell dumpsys package "$package" > "$evidence/baseline-package.txt"
grep -q 'versionName=0\.10\.0' "$evidence/baseline-package.txt"

adb install -r "$candidate" | tee "$evidence/upgrade-install.txt"
launch candidate
adb shell dumpsys package "$package" > "$evidence/candidate-package.txt"

version=$(python -c 'import json; print(json.load(open("release/version.json"))["version"])')
code=$(python -c 'import json; print(json.load(open("release/version.json"))["android_version_code"])')
grep -Fq "versionName=$version" "$evidence/candidate-package.txt"
grep -Fq "versionCode=$code " "$evidence/candidate-package.txt"
for field in 'appId|userId' 'dataDir' 'firstInstallTime'; do
  before=$(grep -m1 -E "^[[:space:]]+($field)=" "$evidence/baseline-package.txt")
  after=$(grep -m1 -E "^[[:space:]]+($field)=" "$evidence/candidate-package.txt")
  [[ "$before" == "$after" ]]
done
python scripts/test_android_update_screen.py --output "$evidence"
python scripts/test_android_typesetting.py --output "$evidence"
echo 'PASS: existing production certificate accepted an in-place Android emulator upgrade; app ID, data path, and original install time preserved.'
