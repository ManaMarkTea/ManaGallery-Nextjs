param(
    [Parameter(Mandatory=$true)][string]$Server,
    [Parameter(Mandatory=$true)][string]$SiteHost,
    [Parameter(Mandatory=$true)][string]$Repository
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$' -or $SiteHost -notmatch '^[a-z0-9.-]+$' -or $Repository -notmatch '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$') { throw 'Invalid server, hostname or repository.' }
git diff --quiet
if ($LASTEXITCODE) { throw 'Commit your local changes first.' }
git diff --cached --quiet
if ($LASTEXITCODE) { throw 'Commit your staged changes first.' }
git push origin main
if ($LASTEXITCODE) { throw 'Git push failed.' }
# Upload only the small bootstrap script; the VPS pulls the application from GitHub.
scp "$PSScriptRoot/pull-vps.sh" "${Server}:rendergallery-pull.sh"
if ($LASTEXITCODE) { throw 'Could not upload deployment helper.' }
ssh -t $Server "bash ~/rendergallery-pull.sh $Repository $SiteHost"
if ($LASTEXITCODE) { throw 'Deployment failed. Inspect the output; do not remove live data.' }
