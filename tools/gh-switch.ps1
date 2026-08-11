# Switch GitHub accounts — PowerShell version, for a normal Windows terminal.
#
# Identical behaviour to tools/gh-switch.sh. See that file for why this changes
# BOTH the pushing account and the committing identity: `gh auth switch` only
# does the first, and switching without the second silently attributes every
# commit to the previous account.
#
# USAGE
#   .\tools\gh-switch.ps1                    show current state
#   .\tools\gh-switch.ps1 lerex4496-bot      switch
#   .\tools\gh-switch.ps1 lerex4496-bot -Local   this repo only
#   .\tools\gh-switch.ps1 -Add               sign in to another account

param(
    [Parameter(Position = 0)][string]$Account,
    [switch]$Local,
    [switch]$Add
)

# The email decides commit attribution on GitHub. Use an address that account
# has verified, or its noreply address (Settings -> Emails -> keep private).
$Emails = @{
    'JigsTRC'       = 'jignesh@therealtorsconcierge.com'
    'lerex4496-bot' = 'lerex4496-bot@users.noreply.github.com'
    'lerex118'      = 'lerex118@users.noreply.github.com'
}

function Show-State {
    $active = (gh api user --jq .login 2>$null)
    if (-not $active) { $active = '(not signed in)' }
    $gname = (git config user.name 2>$null)
    $gemail = (git config user.email 2>$null)
    if (-not $gname) { $gname = '(unset)' }
    if (-not $gemail) { $gemail = '(unset)' }

    Write-Host "pushes as   : $active"
    Write-Host "commits as  : $gname <$gemail>"
    if (Test-Path .git) {
        $remote = (git remote get-url origin 2>$null)
        if (-not $remote) { $remote = '(none)' }
        Write-Host "remote      : $remote"
    }
    Write-Host ''
    Write-Host 'signed-in accounts:'
    gh auth status 2>&1 | Select-String 'Logged in to|Active account' | ForEach-Object { "  $_" }

    if ($active -ne '(not signed in)' -and $Emails.ContainsKey($active) -and $gemail -ne $Emails[$active]) {
        Write-Host ''
        Write-Host "  MISMATCH: pushing as $active but committing as <$gemail>." -ForegroundColor Yellow
        Write-Host "  Run: .\tools\gh-switch.ps1 $active"
    }
}

if ($Add) {
    Write-Host 'Adding an account. Choose HTTPS and authenticate in the browser.'
    gh auth login --hostname github.com
    Write-Host ''
    Show-State
    return
}

if (-not $Account) { Show-State; return }

if (-not $Emails.ContainsKey($Account)) {
    Write-Host "Unknown account: $Account"
    Write-Host ("Known: " + ($Emails.Keys -join ', '))
    Write-Host 'Add it to the $Emails map at the top of this script, then re-run.'
    return
}

$status = gh auth status 2>&1 | Out-String
if ($status -notmatch "account $([regex]::Escape($Account))") {
    Write-Host "$Account is not signed in yet. Run:"
    Write-Host '    .\tools\gh-switch.ps1 -Add'
    return
}

gh auth switch --hostname github.com --user $Account
$scope = if ($Local) { '--local' } else { '--global' }
git config $scope user.name $Account
git config $scope user.email $Emails[$Account]

# Without this, git can keep using a cached credential and push as whoever was
# active before — the exact confusion this script exists to remove.
gh auth setup-git --hostname github.com 2>$null

Write-Host "switched ($($scope.TrimStart('-')) git identity)"
Write-Host ''
Show-State
