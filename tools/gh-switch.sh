#!/usr/bin/env bash
#
# Switch GitHub accounts — both halves of it.
#
# WHY THIS EXISTS
# ---------------
# "Which GitHub account am I?" is actually two separate questions that people
# assume are one:
#
#   1. Which account PUSHES        -> gh auth / the credential helper
#   2. Which name lands in the LOG -> git config user.name and user.email
#
# `gh auth switch` only changes the first. Switch accounts without the second
# and every commit still carries the old identity — the push succeeds, and the
# commits show up attributed to the wrong person, on someone else's contribution
# graph. That is tedious to fix after the fact and impossible once others have
# pulled.
#
# So this always moves both together, and prints the resulting state so it is
# visible rather than assumed.
#
# USAGE
#   tools/gh-switch.sh                 show the current identity and what's available
#   tools/gh-switch.sh lerex4496-bot   switch to that account
#   tools/gh-switch.sh --local NAME    set the git identity for THIS repo only
#   tools/gh-switch.sh --add           sign in to an additional account
#
# ADDING AN ACCOUNT
#   gh auth login --hostname github.com
# Choose HTTPS, authenticate in the browser, and gh stores it alongside the
# others. `gh auth switch` moves between them from then on; nothing is logged
# out and no token is retyped.

set -euo pipefail

# ── your accounts ─────────────────────────────────────────────────────────────
# The email decides who a commit is attributed to on GitHub. Use the address
# that account has verified, or the noreply address GitHub gives it
# (Settings -> Emails -> "Keep my email address private"), otherwise commits
# show as unattributed even though the push worked.
declare -A EMAILS=(
  ["JigsTRC"]="jignesh@therealtorsconcierge.com"
  ["lerex4496-bot"]="lerex4496@gmail.com"
  ["jigs1188"]="parmarjigs1188@gmail.com"
)

SCOPE="--global"
if [[ "${1:-}" == "--local" ]]; then
  SCOPE="--local"
  shift
fi

show() {
  local active gname gemail
  active="$(gh auth status 2>/dev/null | awk '/Active account: true/{found=1} /Logged in to/{acct=$NF} END{}' || true)"
  active="$(gh api user --jq .login 2>/dev/null || echo '(not signed in)')"
  gname="$(git config user.name 2>/dev/null || echo '(unset)')"
  gemail="$(git config user.email 2>/dev/null || echo '(unset)')"

  echo "pushes as   : $active"
  echo "commits as  : $gname <$gemail>"
  if [[ -d .git ]]; then
    echo "remote      : $(git remote get-url origin 2>/dev/null || echo '(none)')"
  fi
  echo
  echo "signed-in accounts:"
  gh auth status 2>/dev/null | grep -E "Logged in to|Active account" | sed 's/^/  /' || echo "  none"

  # The failure this catches: pushing fine but committing as someone else.
  if [[ "$active" != "(not signed in)" && -n "${EMAILS[$active]:-}" && "$gemail" != "${EMAILS[$active]}" ]]; then
    echo
    echo "  MISMATCH: pushing as $active but committing as <$gemail>."
    echo "  Run: tools/gh-switch.sh $active"
  fi
}

if [[ "${1:-}" == "--add" ]]; then
  echo "Adding an account. Choose HTTPS and authenticate in the browser."
  gh auth login --hostname github.com
  echo
  show
  exit 0
fi

if [[ $# -eq 0 ]]; then
  show
  exit 0
fi

TARGET="$1"
if [[ -z "${EMAILS[$TARGET]:-}" ]]; then
  echo "Unknown account: $TARGET"
  echo "Known: ${!EMAILS[*]}"
  echo "Add it to the EMAILS map at the top of this script, then re-run."
  exit 1
fi

if ! gh auth status 2>/dev/null | grep -q "account $TARGET"; then
  echo "$TARGET is not signed in yet. Run:"
  echo "    tools/gh-switch.sh --add"
  exit 1
fi

gh auth switch --hostname github.com --user "$TARGET"
git config $SCOPE user.name "$TARGET"
git config $SCOPE user.email "${EMAILS[$TARGET]}"

# gh's credential helper is what makes a push use the newly active account. If
# it is not wired up, git falls back to a cached credential and pushes as
# whoever was there before — the exact confusion this script exists to remove.
gh auth setup-git --hostname github.com 2>/dev/null || true

echo "switched (${SCOPE#--} git identity)"
echo
show
