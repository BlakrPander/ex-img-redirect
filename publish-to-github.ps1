#Requires -Version 5.1
<#
.SYNOPSIS
    Publish this repository to GitHub and create a Release with the packaged extension.

.DESCRIPTION
    Requires a GitHub Personal Access Token (PAT).
      - Classic token: needs the "repo" scope (required for Releases too).
      - Fine-grained token: Repository permissions -> Contents: Read and write, Metadata: Read.

.EXAMPLE
    .\publish-to-github.ps1 -RepoName 'ex-img-redirect'

.EXAMPLE
    .\publish-to-github.ps1 -Token $env:GITHUB_TOKEN -RepoName 'ex-img-redirect'
#>
[CmdletBinding()]
param(
    [string]$Token,
    [string]$Owner = 'BlakrPander',
    [string]$RepoName = 'ex-img-redirect',
    [string]$Description = 'Redirect image requests from s.exhentai.org to ehgt.org (Chrome/Edge extension). Some networks cannot resolve s.exhentai.org; both hostnames point to the same storage backend.',
    [string]$RepoRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$ReleaseTag = 'v1.0.1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($msg) { Write-Host "" ; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ---------- 0. Token ----------
if ([string]::IsNullOrWhiteSpace($Token)) {
    $sec = Read-Host -AsSecureString 'GitHub Personal Access Token (input is hidden)'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$Token = $Token.Trim()
if ([string]::IsNullOrWhiteSpace($Token)) { throw 'No token provided.' }

$apiBase = 'https://api.github.com'
$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'ex-img-redirect-publish'
}

function Post-Json([string]$uri, $obj) {
    $json = $obj | ConvertTo-Json -Depth 8
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 90
}

# ---------- 1. Verify token ----------
Write-Step '1. Verify token'
try {
    $me = Invoke-RestMethod -Uri "$apiBase/user" -Headers $headers -TimeoutSec 30
    Write-Ok "Authenticated as $($me.login)"
    if ($me.login -ne $Owner) {
        Write-Note "Token belongs to '$($me.login)'; using it as the repository owner."
        $Owner = $me.login
    }
} catch {
    throw "Token verification failed: $($_.Exception.Message)"
}

# ---------- 2. Create repository ----------
Write-Step "2. Create repository $Owner/$RepoName"
$repoUrl = "https://github.com/$Owner/$RepoName"
try {
    $repo = Post-Json "$apiBase/user/repos" @{
        name        = $RepoName
        description = $Description
        private     = $false
        has_issues  = $true
        has_wiki    = $false
    }
    Write-Ok "Created: $($repo.html_url)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 422) {
        Write-Note "Repository already exists, reusing it: $repoUrl"
    } else {
        throw "Create repository failed (HTTP $code): $($_.Exception.Message)"
    }
}

# ---------- 3. Configure local remote ----------
Write-Step '3. Configure local git remote'
Push-Location $RepoRoot
try {
    if (-not (Test-Path '.git')) { throw "Not a git repository: $RepoRoot" }
    & git remote remove origin 2>$null | Out-Null
    & git remote add origin "$repoUrl.git"
    Write-Ok "origin = $repoUrl.git"
    $lastCommit = & git log --oneline -1 2>$null
    if (-not $lastCommit) { throw 'Local repository has no commits.' }
    Write-Ok "HEAD: $lastCommit"

    # ---------- 4. Push ----------
    Write-Step '4. Push main'
    $pushUrl = "https://x-access-token:$Token@github.com/$Owner/$RepoName.git"
    & git -c credential.helper= push $pushUrl 'refs/heads/main:refs/heads/main' --force
    if ($LASTEXITCODE -ne 0) { throw 'Push failed. Check that the token can write repository contents.' }
    Write-Ok 'Push completed'
    & git fetch origin 2>$null | Out-Null
    & git branch --set-upstream-to=origin/main main 2>$null | Out-Null
} finally {
    Pop-Location
}

# ---------- 5. Build archive if missing ----------
Write-Step '5. Ensure release archive exists'
$assetName = "ex-img-rewrite-$ReleaseTag.zip"
$zip = Join-Path $RepoRoot ("dist\" + $assetName)
if (-not (Test-Path $zip)) {
    Write-Note "Archive missing, packaging now..."
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) { & node (Join-Path $RepoRoot 'build-release.mjs') } else { throw "Missing $zip and node is not installed." }
}
if (-not (Test-Path $zip)) { throw "Archive still missing: $zip" }
Write-Ok "$zip ($((Get-Item $zip).Length) bytes)"

# ---------- 6. Create Release ----------
Write-Step "6. Create Release $ReleaseTag"

$noteLines = @(
    '## Install',
    '',
    '1. Download `' + $assetName + '` below',
    '2. Unzip it anywhere',
    '3. Open `chrome://extensions/` and enable **Developer mode** (top right)',
    '4. Click **Load unpacked** and pick the unzipped `ex-img-rewrite` folder',
    '',
    '## What this extension does',
    '',
    'It redirects image requests for `s.exhentai.org` (and the numbered hosts `s1`/`s2`/`s3`...) to `ehgt.org` at the network layer, keeping the path, filename and query string unchanged.',
    '',
    '**Why:** on some networks the proxy cannot resolve the `s.exhentai.org` hostname, while `ehgt.org` points to the very same storage backend with an identical path layout. Swapping the hostname makes the images load.',
    '',
    '## Notes',
    '',
    '- Redirect happens before the request is sent (`declarativeNetRequest`), so there is no broken-image flash.',
    '- A content script also rewrites `srcset`, `data-src`, inline `style` background images and dynamically inserted images as a fallback.',
    '- Badge counter, popup diagnostics panel and a one-click on/off switch are included.',
    '- No data collection, no remote code.'
)
$releaseBody = $noteLines -join "`n"

$rel = $null
try {
    $rel = Post-Json "$apiBase/repos/$Owner/$RepoName/releases" @{
        tag_name         = $ReleaseTag
        target_commitish = 'main'
        name             = $ReleaseTag
        body             = $releaseBody
        draft            = $false
        prerelease       = $false
    }
    Write-Ok "Release created: $($rel.html_url)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 422) {
        Write-Note 'Release for this tag already exists, reusing it.'
        $rel = Invoke-RestMethod -Uri "$apiBase/repos/$Owner/$RepoName/releases/tags/$ReleaseTag" -Headers $headers -TimeoutSec 60
        Write-Ok "Release: $($rel.html_url)"
    } else {
        throw "Create release failed (HTTP $code): $($_.Exception.Message)"
    }
}

# ---------- 7. Upload asset ----------
Write-Step '7. Upload release asset'
$uploadUrl = ($rel.upload_url -replace '\{.*$', '')
$boundary = '----DSHFormBoundary' + [Guid]::NewGuid().ToString('N')
$fileBytes = [IO.File]::ReadAllBytes($zip)
$ms = New-Object IO.MemoryStream
$enc = [Text.Encoding]::UTF8

$pre = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"$assetName`"`r`nContent-Type: application/zip`r`n`r`n"
$preBytes = $enc.GetBytes($pre)
$ms.Write($preBytes, 0, $preBytes.Length)
$ms.Write($fileBytes, 0, $fileBytes.Length)
$postBytes = $enc.GetBytes("`r`n--$boundary--`r`n")
$ms.Write($postBytes, 0, $postBytes.Length)
$payload = $ms.ToArray()
$ms.Dispose()

try {
    $up = Invoke-RestMethod -Uri ($uploadUrl + '?name=' + $assetName) -Method Post -Headers $headers -Body $payload -ContentType "multipart/form-data; boundary=$boundary" -TimeoutSec 300
    Write-Ok "Uploaded: $($up.browser_download_url)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Write-Note "Upload failed (HTTP $code): $($_.Exception.Message)"
    Write-Note "You can attach the file manually on the release page: $($rel.html_url)"
}

# ---------- Done ----------
Write-Step 'Done'
Write-Host "Repository : $repoUrl" -ForegroundColor Green
Write-Host "Release    : $($rel.html_url)" -ForegroundColor Green
Write-Host ''
Write-Host 'The token was only used in memory and in the push URL; it is not stored in git config.' -ForegroundColor Yellow
Write-Host 'Revoke the token on GitHub after use.' -ForegroundColor Yellow
