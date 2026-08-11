#!/usr/bin/env bash
# Screenshot the running Octogent dashboard.
#
#   bash .claude/skills/octogent/shot.sh <out.png> [url]
#
# Why a script and not a one-liner: headless Chrome on Windows does not exit
# after --screenshot when a normal Chrome is already running, and PowerShell's
# call operator loses the written file. Running it from bash, backgrounded,
# then polling for a non-empty file and killing the process, is the form that
# actually produces a PNG. See SKILL.md > Gotchas.
set -u

OUT="${1:-octogent.png}"
URL="${2:-http://127.0.0.1:8787}"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"

[ -x "$CHROME" ] || { echo "chrome not found at $CHROME" >&2; exit 1; }

OUTDIR=$(dirname "$OUT")
OUTBASE=$(basename "$OUT")
mkdir -p "$OUTDIR"
cd "$OUTDIR" || exit 1
rm -f "$OUTBASE"

# Must be a relative filename with cwd set — an absolute --screenshot path
# gets "Access is denied" from headless Chrome here.
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=12000 \
  --screenshot="$OUTBASE" "$URL" >/dev/null 2>&1 &
CPID=$!

for _ in $(seq 1 30); do
  [ -s "$OUTBASE" ] && break
  sleep 2
done
kill $CPID 2>/dev/null

if [ -s "$OUTBASE" ]; then
  echo "wrote $(pwd)/$OUTBASE ($(wc -c < "$OUTBASE") bytes)"
else
  echo "no screenshot produced — is Octogent running at $URL ?" >&2
  exit 1
fi
