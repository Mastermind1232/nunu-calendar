#!/usr/bin/env bash
# Ship a version. Every check must pass or nothing leaves this machine.
set -euo pipefail
VERSION=$(node -p "require('./module.json').version")
NOTES=${1:?"usage: ./release.sh \"release notes\""}
echo "── checking ${VERSION}"
for f in scripts/*.mjs; do node --check "$f"; done
echo "   javascript parses"
node -e 'import("./scripts/lib.mjs").then(() => {}).catch(e => { console.error(e.message); process.exit(1); })'
echo "   library imports"
node --test tests/*.test.mjs > /dev/null
echo "   tests pass"
node -e '
const s = require("fs").readFileSync("styles/calendar.css", "utf8");
let b = 0; for (const ch of s) { if (ch === "{") b++; if (ch === "}") b--; }
if (b !== 0) { console.error(`  stylesheet braces unbalanced by ${b}`); process.exit(1); }
'
echo "   stylesheet balances"
git diff --quiet && git diff --cached --quiet || { git add -A; git commit -qm "${VERSION}: ${NOTES}"; }
git push -q
zip -qr module.zip module.json scripts styles templates lang README.md 2>/dev/null || zip -qr module.zip module.json scripts styles README.md
gh release create "v${VERSION}" module.zip -t "v${VERSION}" -n "${NOTES}" > /dev/null
rm -f module.zip
echo "── shipped v${VERSION}"
