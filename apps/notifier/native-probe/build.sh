#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
output="$PWD/.debug/notifier-native/DSCanvas Notifier Probe.app"
mkdir -p "$output/Contents/MacOS"
xcrun swiftc -target "$(uname -m)-apple-macosx11.0" -O \
  apps/notifier/native-probe/main.swift -framework AppKit -framework UserNotifications \
  -o "$output/Contents/MacOS/notifier-probe"
cat > "$output/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>notifier-probe</string>
<key>CFBundleIdentifier</key><string>io.github.zy-wang-0304.dsc.notifier.probe</string>
<key>CFBundleName</key><string>DSCanvas Notifier Probe</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.0.1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --sign - "$output"
codesign --verify --strict "$output"
ditto -c -k --keepParent "$output" "$PWD/.debug/notifier-native/notifier-probe.zip"
shasum -a 256 "$PWD/.debug/notifier-native/notifier-probe.zip"
printf '%s\n' "$output"
