#!/bin/bash
# Signs a local Mac build with the self-signed "Talaria Local Signing" certificate from the login keychain.
#
# Why: Chromium keeps the cookie key in the macOS Keychain. An ad-hoc signed build gets a new identity every time,
# so after each update the Keychain does not know the app. If its access prompt is denied or missed, Chromium cannot
# decrypt the cookies and deletes them (every site signs you out). Signed with one certificate, every build has the
# same identity ("certificate leaf = <hash>"), so the Keychain trusts updates after one "Always Allow".
#
# electron-builder only signs with certificates macOS trusts, so it skips this one; codesign accepts it as it is.
# Usage: scripts/sign-local-mac.sh [path/to/Talaria.app]
set -euo pipefail

NAME="Talaria Local Signing"
APP="${1:-dist.noindex/mac-arm64/Talaria.app}"
ENT="build/entitlements.mac.local.plist" # the release entitlements plus one line; see that file
ENT_INHERIT="build/entitlements.mac.inherit.local.plist"

ID=$(security find-identity -p codesigning | awk -v n="\"$NAME\"" 'index($0, n) { print $2; exit }')
if [ -z "$ID" ]; then
  echo "No \"$NAME\" certificate in the login keychain." >&2
  echo "Make one once: Keychain Access > Certificate Assistant > Create a Certificate, name \"$NAME\"," >&2
  echo "identity type Self-Signed Root, certificate type Code Signing. Leave its trust settings as they are." >&2
  exit 1
fi
[ -d "$APP" ] || { echo "No app at $APP. Run pnpm dist:mac first." >&2; exit 1; }

sign() { codesign --force --timestamp=none --options runtime -s "$ID" "$@"; }

# Inside out: loose libraries first, then frameworks, then the helper apps, then the app itself.
find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.so" -o -name "*.node" \) -print0 | while IFS= read -r -d '' f; do sign "$f"; done
for fw in "$APP"/Contents/Frameworks/*.framework; do sign "$fw"; done
for helper in "$APP"/Contents/Frameworks/*.app; do sign --entitlements "$ENT_INHERIT" "$helper"; done
sign --entitlements "$ENT" "$APP"

codesign --verify --deep --strict "$APP"
codesign -dr - "$APP" 2>&1 | grep designated
echo "Signed $APP with \"$NAME\"."
