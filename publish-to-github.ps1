#Requires -Version 5.1
<#
.SYNOPSIS
    把本地仓库发布到 GitHub，并创建 Release 上传打包好的扩展。

.DESCRIPTION
    需要 GitHub Personal Access Token（下称 PAT）。
      - 经典 token：勾选 repo 即可（要发 release 也必须 repo）
      - 细粒度 token：Repository permissions -> Contents: Read and write；Metadata: Read
    建议用「细粒度 + 仅本仓库」的 token，用完即删。

.EXAMPLE
    .\publish-to-github.ps1 -Token 'ghp_xxxxxxxx' -RepoName 'ex-img-redirect'

.EXAMPLE
    # 不传 token 会安全提示输入（不留在历史记录里）
    .\publish-to-github.ps1 -RepoName 'ex-img-redirect'
#>
[CmdletBinding()]
param(
    [string]$Token,
    [string]$Owner = 'BlakrPander',
    [string]$RepoName = 'ex-img-redirect',
    [string]$Description = '把 s.exhentai.org 的图片请求重定向到 ehgt.org 的 Chrome/Edge 扩展（部分网络下 s.exhentai.org 无法解析，两者指向同一个存储库）',
    [string]$RepoRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$ReleaseTag = 'v1.0.1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

# ---------- 0. 拿 token ----------
if ([string]::IsNullOrWhiteSpace($Token)) {
    $sec = Read-Host -AsSecureString '请输入 GitHub Personal Access Token（输入不回显，不要粘贴到聊天里）'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$Token = $Token.Trim()
if ([string]::IsNullOrWhiteSpace($Token)) { throw '未提供 token。' }

$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'ex-img-redirect-publish'
}

# ---------- 1. 校验 token ----------
Write-Step '1. 校验 token'
try {
    $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
    Write-Ok "已认证为 $($me.login)"
    if ($Owner -eq 'BlakrPander' -and $me.login -ne 'BlakrPander') {
        Write-Warn2 "注意：token 属于 $($me.login)，将使用它作为仓库所有者"
        $Owner = $me.login
    }
} catch {
    throw "token 校验失败：$($_.Exception.Message)"
}

# 探测 token 类型与权限
try {
    $r = Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30 -UseBasicParsing
    $scopes = $r.Headers['X-OAuth-Scopes']
    if ($scopes) { Write-Ok "经典 token，scopes: $scopes" }
    else { Write-Ok '细粒度 token（或无显式 scope）' }
} catch { }

# ---------- 2. 创建仓库 ----------
Write-Step "2. 创建仓库 $Owner/$RepoName"
$repoCreated = $false
try {
    $body = @{
        name        = $RepoName
        description = $Description
        private     = $false
        has_issues  = $true
        has_wiki    = $false
    } | ConvertTo-Json
    $repo = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -Headers $headers `
        -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
    Write-Ok "已创建：$($repo.html_url)"
    $repoCreated = $true
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 422) {
        Write-Warn2 "仓库已存在，继续使用：https://github.com/$Owner/$RepoName"
    } else {
        throw "创建仓库失败（HTTP $code）：$($_.Exception.Message)"
    }
}

# ---------- 3. 补全本地仓库信息 ----------
Write-Step '3. 配置本地仓库并提交打包产物说明'
Push-Location $RepoRoot
try {
    if (-not (Test-Path '.git')) { throw "当前目录不是 git 仓库：$RepoRoot" }

    & git remote remove origin 2>$null | Out-Null
    & git remote add origin "https://github.com/$Owner/$RepoName.git"
    Write-Ok "remote origin = https://github.com/$Owner/$RepoName.git"

    # 确保有提交
    $log = & git log --oneline -1 2>$null
    if (-not $log) { throw '本地仓库还没有任何提交。' }
    Write-Ok "最新提交：$log"

    # ---------- 4. 推送 ----------
    Write-Step '4. 推送 main'
    $pushUrl = "https://x-access-token:$Token@github.com/$Owner/$RepoName.git"
    & git -c credential.helper= push $pushUrl 'refs/heads/main:refs/heads/main' --force 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { throw '推送失败。请确认 token 有 repo / Contents 写权限。' }
    Write-Ok '推送完成'

    # 让本地 origin 走普通 URL（token 不写入 git config）
    & git branch --set-upstream-to="origin/main" main 2>&1 | Out-Null
} finally {
    Pop-Location
}

# ---------- 5. 创建 Release ----------
Write-Step "5. 创建 Release $ReleaseTag"
$zip = Join-Path $RepoRoot "dist\ex-img-rewrite-$ReleaseTag.zip"
if (-not (Test-Path $zip)) {
    # 尝试构建
    Write-Warn2 "没找到 $zip，尝试运行 build-release.mjs"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { & node (Join-Path $RepoRoot 'build-release.mjs') } else { throw "缺少 $zip 且未安装 node，无法打包。" }
}
if (-not (Test-Path $zip)) { throw "打包文件不存在：$zip" }
Write-Ok "打包文件：$zip ($((Get-Item $zip).Length) 字节)"

$releaseBody = @"
## 安装

1. 下载下方 `ex-img-rewrite-$ReleaseTag.zip`
2. 解压到任意目录
3. 打开 ``chrome://extensions/`` → 右上角开启**开发者模式**
4. 点**加载已解压的扩展程序** → 选择解压出的 ``ex-img-rewrite`` 文件夹

## 这个版本做了什么

把 ``s.exhentai.org``（及 ``s1``/``s2``/``s3``… 编号子域）的图片请求，在**网络请求层**重定向到 ``ehgt.org``，路径、文件名、query 参数完整保留。

**原因**：部分网络环境下代理无法解析 ``s.exhentai.org`` 域名，而 ``ehgt.org`` 与它指向的实际上是同一个存储库，路径结构一致，换域名即可正常加载。

## 变更

- 首个公开版本
- 请求层重定向（declarativeNetRequest），无闪烁
- 内容脚本兜底：``srcset`` / ``data-src`` / 内联 ``style`` 背景图 / ``MutationObserver``
- 图标角标计数、弹窗诊断面板、一键开关
- 弹窗中不再内置样例图链接
"@

$rel = $null
try {
    $relBody = @{
        tag_name         = $ReleaseTag
        target_commitish = 'main'
        name             = "v$($ReleaseTag.TrimStart('v'))"
        body             = $releaseBody
        draft            = $false
        prerelease       = $false
    } | ConvertTo-Json
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$RepoName/releases" -Method Post -Headers $headers `
        -Body ([Text.Encoding]::UTF8.GetBytes($relBody)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
    Write-Ok "Release 已创建：$($rel.html_url)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 422) {
        Write-Warn2 "该 tag 的 Release 已存在，改为查询并复用"
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$RepoName/releases/tags/$ReleaseTag" -Headers $headers -TimeoutSec 60
    } else {
        throw "创建 Release 失败（HTTP $code）：$($_.Exception.Message)"
    }
}

# ---------- 6. 上传资产 ----------
Write-Step '6. 上传 zip 到 Release'
$assetName = Split-Path $zip -Leaf
$uploadUrl = ($rel.upload_url -replace '\{.*$', '')

# 构造 multipart/form-data
$boundary = '----DSHBoundary' + [Guid]::NewGuid().ToString('N')
$fileBytes = [IO.File]::ReadAllBytes($zip)
$ms = New-Object IO.MemoryStream
$enc = [Text.Encoding]::UTF8

$pre = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"$assetName`"`r`nContent-Type: application/zip`r`n`r`n"
$preBytes = $enc.GetBytes($pre)
$ms.Write($preBytes, 0, $preBytes.Length)
$ms.Write($fileBytes, 0, $fileBytes.Length)
$post = "`r`n--$boundary--`r`n"
$postBytes = $enc.GetBytes($post)
$ms.Write($postBytes, 0, $postBytes.Length)
$payload = $ms.ToArray()
$ms.Dispose()

try {
    $up = Invoke-RestMethod -Uri "$uploadUrl?name=$assetName" -Method Post -Headers $headers `
        -Body $payload -ContentType "multipart/form-data; boundary=$boundary" -TimeoutSec 180
    Write-Ok "已上传：$($up.browser_download_url)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Write-Warn2 "上传失败（HTTP $code）：$($_.Exception.Message)"
    Write-Warn2 "可以手动把 $zip 拖到 Release 页面：$($rel.html_url)"
}

# ---------- 完成 ----------
Write-Step '完成'
Write-Host "仓库     : https://github.com/$Owner/$RepoName" -ForegroundColor Green
Write-Host "Release  : $($rel.html_url)" -ForegroundColor Green
Write-Host ""
Write-Host "安全提示：token 只在本进程内存和使用它拼接的推送 URL 中出现，未写入 git config。" -ForegroundColor Yellow
Write-Host "         用完后建议到 GitHub 设置里删除该 token。" -ForegroundColor Yellow
