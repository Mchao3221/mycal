# MyDocs 同步脚本(PowerShell 版,不依赖 Node)
#
# 为什么有这一版:用户机器上 nvm 里只有 Node v14,而 .mjs 那版需要 Node 18+(全局 fetch),
# 所以 `pnpm run sync` 在他机器上根本起不来。这版用 Windows 自带的 PowerShell,
# 什么都不用装,双击 sync.cmd 就能跑。
#
# 它做的事和 tools/sync-docs.mjs 完全一样:
#   读本地文档目录 → 算每个文件的内容哈希 → 与服务端清单比对 → 只传变化的 → 收尾 → 自检
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File tools\sync-docs.ps1
#   powershell -ExecutionPolicy Bypass -File tools\sync-docs.ps1 -Url https://xxx.workers.dev -Password 访问码
#   powershell -ExecutionPolicy Bypass -File tools\sync-docs.ps1 -Dir D:\docs
#
# 默认值从项目根目录的 .dev.vars 读:DOCS_DIR / SYNC_URL / SYNC_PASSWORD

#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Dir,
  [string]$Url,
  [string]$Password
)

$ErrorActionPreference = 'Stop'
# 5.1 默认可能还是 TLS 1.0,连不上 Cloudflare
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$IgnoreExt = @('zip')   # 与 worker/paths.ts 的 IGNORED_EXT 保持一致
$Batch = 6

function Fail([string]$Message) {
  Write-Host ''
  Write-Host "[错误] $Message" -ForegroundColor Red
  Write-Host ''
  exit 1
}

# ---------- 读 .dev.vars ----------

function Read-DevVars {
  $map = @{}
  $file = Join-Path $ProjectRoot '.dev.vars'
  if (-not (Test-Path $file)) { return $map }
  foreach ($line in [System.IO.File]::ReadAllLines($file)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $map[$Matches[1]] = $Matches[2].Trim('"', "'")
    }
  }
  return $map
}

$vars = Read-DevVars
if (-not $Dir)      { $Dir = if ($vars['DOCS_DIR']) { $vars['DOCS_DIR'] } else { 'C:\03Docs\my-docs' } }
if (-not $Url)      { $Url = if ($vars['SYNC_URL']) { $vars['SYNC_URL'] } else { 'http://localhost:5173' } }
if (-not $Password) { $Password = $vars['SYNC_PASSWORD'] }
$Url = $Url.TrimEnd('/')

# ---------- 工具函数 ----------

function Get-BlobSha([byte[]]$Bytes) {
  # git 的内容哈希:sha1("blob <字节数>`0" + 内容)
  $header = [System.Text.Encoding]::UTF8.GetBytes("blob " + $Bytes.Length + [char]0)
  $all = New-Object byte[] ($header.Length + $Bytes.Length)
  [System.Buffer]::BlockCopy($header, 0, $all, 0, $header.Length)
  [System.Buffer]::BlockCopy($Bytes, 0, $all, $header.Length, $Bytes.Length)
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    return (($sha.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [byte[]]$Body,
    [string]$ContentType = 'application/json; charset=utf-8'
  )
  # 注意:这里叫 $req 而不是 $args —— $args 是 PowerShell 的自动变量,不能被赋值
  $req = @{
    Uri         = "$Url$Path"
    Method      = $Method
    WebSession  = $script:Session
    TimeoutSec  = 60
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $req['Body'] = $Body
    $req['ContentType'] = $ContentType
  }
  try {
    return Invoke-RestMethod @req
  } catch {
    $detail = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    $status = ''
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    throw "HTTP $status $detail"
  }
}

function Send-Json([string]$Method, [string]$Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 6 -Compress
  # 5.1 的 Invoke-RestMethod 对字符串 body 会按非 UTF-8 编码发出去,中文会坏 —— 必须自己转字节
  return Invoke-Api -Method $Method -Path $Path -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}

# ---------- 扫描本地目录 ----------

function Get-DocFiles([string]$Root) {
  $out = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  $stack.Push($Root)
  while ($stack.Count -gt 0) {
    $current = $stack.Pop()
    foreach ($entry in [System.IO.Directory]::GetFileSystemEntries($current)) {
      $name = [System.IO.Path]::GetFileName($entry)
      # 任何以 '.' 开头的路径段都视为隐藏(与前端、worker 的规则一致)
      if ($name.StartsWith('.')) { continue }
      if ([System.IO.Directory]::Exists($entry)) {
        $stack.Push($entry)
      } else {
        $ext = [System.IO.Path]::GetExtension($name).TrimStart('.').ToLowerInvariant()
        if ($IgnoreExt -contains $ext) { continue }
        $rel = $entry.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/'
        [void]$out.Add([pscustomobject]@{ Rel = $rel; Full = $entry; Sha = '' })
      }
    }
  }
  return $out
}

function Get-Rev([string]$Root, $Files) {
  try {
    $r = & git -C $Root rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $r) { return ([string]$r).Trim() }
  } catch { }
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    $text = ($Files | ForEach-Object { "$($_.Rel):$($_.Sha)" }) -join "`n"
    return (($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

# ---------- 主流程 ----------

$script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$root = [System.IO.Path]::GetFullPath($Dir).TrimEnd('\', '/')
Write-Host ''
Write-Host "本地目录 $root"
Write-Host "阅读器   $Url"
Write-Host ''

if (-not [System.IO.Directory]::Exists($root)) {
  Fail "本地文档目录不存在:$root`n请在 .dev.vars 里设置 DOCS_DIR,或用 -Dir 指定"
}

# 1) 解锁
try { $status = Invoke-Api -Method Get -Path '/api/lock/status' }
catch { Fail "连不上阅读器 $Url`n$($_.Exception.Message)`n(本地开发请先 pnpm run dev;线上请用 -Url 指定地址)" }

if (-not $status.isSet) {
  if (-not $Password) { Fail "阅读器还没有设置访问码,请先用 -Password 指定一个" }
  try { [void](Send-Json 'Post' '/api/lock/setup' @{ password = $Password }) }
  catch { Fail "设置访问码失败:$($_.Exception.Message)" }
} elseif (-not $status.unlocked) {
  if (-not $Password) { Fail '阅读器已上锁:请在 .dev.vars 里填 SYNC_PASSWORD,或用 -Password 传入访问码' }
  try { [void](Send-Json 'Post' '/api/lock/unlock' @{ password = $Password }) }
  catch { Fail "解锁失败:$($_.Exception.Message)" }
}

# 2) 服务端清单
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try { $remote = Invoke-Api -Method Get -Path '/api/docs/tree' }
catch { Fail "读取服务端清单失败:$($_.Exception.Message)" }

$remoteShas = @{}
foreach ($f in $remote.files) { $remoteShas[$f.path] = $f.sha }
$when = if ($remote.syncedAt -gt 0) { ([datetime]'1970-01-01').AddMilliseconds($remote.syncedAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm') } else { '从未完成过同步' }
Write-Host "服务端已有 $($remote.files.Count) 个文件(上次同步:$when)"

# 3) 扫描本地 + 算哈希
$all = Get-DocFiles $root
$need = New-Object System.Collections.ArrayList
$unchanged = 0
$i = 0
foreach ($f in $all) {
  $bytes = [System.IO.File]::ReadAllBytes($f.Full)
  $f.Sha = Get-BlobSha $bytes
  if ($remoteShas[$f.Rel] -eq $f.Sha) { $unchanged++ } else { [void]$need.Add($f) }
  $i++
  if ($i % 200 -eq 0) { Write-Host -NoNewline "`r  正在扫描本地 $i/$($all.Count)   " }
}
$rev = Get-Rev $root $all
Write-Host "`r  本地共 $($all.Count) 个文件,其中 $($need.Count) 个需要上传(未变 $unchanged 个),rev $($rev.Substring(0, [Math]::Min(8, $rev.Length)))"
Write-Host ''

# 4) 上传(失败自动重试三轮;半截数据以前就是这么来的,必须重试 + 自检)
$uploaded = 0
$pending = $need
$failed = @()
for ($attempt = 1; $attempt -le 3 -and $pending.Count -gt 0; $attempt++) {
  if ($attempt -gt 1) {
    Write-Host "  第 $attempt 轮:重试 $($pending.Count) 个…"
    Start-Sleep -Seconds ($attempt - 1)
  }
  $bad = New-Object System.Collections.ArrayList
  $n = 0
  foreach ($f in $pending) {
    try {
      $bytes = [System.IO.File]::ReadAllBytes($f.Full)
      $path = '/api/sync/put?path=' + [uri]::EscapeDataString($f.Rel) + '&sha=' + $f.Sha
      [void](Invoke-Api -Method Post -Path $path -Body $bytes -ContentType 'application/octet-stream')
      $uploaded++
    } catch {
      [void]$bad.Add([pscustomobject]@{ Rel = $f.Rel; Full = $f.Full; Sha = $f.Sha; Error = $_.Exception.Message })
    }
    $n++
    if ($n % 25 -eq 0 -or $n -ge $pending.Count) {
      Write-Host -NoNewline "`r  已上传 $uploaded  本轮进度 $n/$($pending.Count)  失败 $($bad.Count)  $([math]::Round($sw.Elapsed.TotalSeconds))s   "
    }
  }
  $pending = $bad
  $failed = $bad
}
if ($need.Count -gt 0) { Write-Host '' }

# 5) 收尾
Write-Host -NoNewline '  收尾中…'
try {
  $finish = Send-Json 'Post' '/api/sync/finish' @{ paths = @($all | ForEach-Object { $_.Rel }); rev = $rev }
} catch { Fail "收尾失败:$($_.Exception.Message)" }

# 6) 自检:回读服务端清单与本地逐一对账
try { $after = Invoke-Api -Method Get -Path '/api/docs/tree' }
catch { Fail "自检失败:$($_.Exception.Message)" }

$have = @{}
foreach ($f in $after.files) { $have[$f.path] = $true }
$missing = @($all | Where-Object { -not $have[$_.Rel] } | ForEach-Object { $_.Rel })

Write-Host "`r  完成:上传 $uploaded 个,删除 $($finish.removed) 个  "
Write-Host "  服务端现有 $($after.files.Count) 个 / 本地 $($all.Count) 个"
Write-Host "  用时 $([math]::Round($sw.Elapsed.TotalSeconds)) 秒"
Write-Host ''

$exitCode = 0
if ($missing.Count -eq 0) {
  Write-Host '  自检:两边文件清单完全一致 OK' -ForegroundColor Green
} else {
  Write-Host "  [!] 自检发现服务端还缺 $($missing.Count) 个文件 —— 应用里会看不到它们:" -ForegroundColor Yellow
  $missing | Select-Object -First 10 | ForEach-Object { Write-Host "     $_" }
  if ($missing.Count -gt 10) { Write-Host "     …还有 $($missing.Count - 10) 个" }
  Write-Host '  再跑一次本脚本即可续传(已传成功的不会重复上传)。'
  $exitCode = 1
}
if ($failed.Count -gt 0) {
  Write-Host "  [!] 有 $($failed.Count) 个文件三轮都没传上去:" -ForegroundColor Yellow
  $failed | Select-Object -First 10 | ForEach-Object { Write-Host "     $($_.Rel) → $($_.Error)" }
  $exitCode = 1
}

exit $exitCode
