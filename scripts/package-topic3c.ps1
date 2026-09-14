[CmdletBinding()]
param(
  [string]$Output = "submission/topic3c-final-20260914.zip"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repo $Output))
$submissionRoot = [System.IO.Path]::GetFullPath((Join-Path $repo "submission"))
if (-not $outputPath.StartsWith($submissionRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output must remain under $submissionRoot"
}
if (Test-Path -LiteralPath $outputPath) {
  throw "Output already exists: $outputPath"
}

# Include reviewed new files explicitly; tracked files always come from the
# working tree so a local fix cannot silently be replaced by an older HEAD.
$additional = @(
  "MemoryCore/package-lock.json",
  "MemoryCore/src/core/hooks/auto-recall.test.ts",
  "docs/topic3c/FINAL_REPORT.md",
  "results/swe-public-reproduction-audit.json",
  "results/final-verification.json"
)
$tracked = @(& git -C $repo -c core.quotepath=false ls-files)
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed" }
$gitlinks = @(& git -C $repo -c core.quotepath=false ls-files --stage | Where-Object { $_ -match '^160000 ' })
if ($LASTEXITCODE -ne 0) { throw "git gitlink inventory failed" }
$gitlinkPaths = @($gitlinks | ForEach-Object { ($_ -split "`t", 2)[1] })
$untracked = @(& git -C $repo -c core.quotepath=false ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw "git untracked inventory failed" }
$unexpected = @($untracked | Where-Object { $_ -notin $additional -and $_ -notlike 'submission/*' })
if ($unexpected.Count) { throw "Review new files before packaging: $($unexpected -join ', ')" }
$files = @($tracked + $additional | Sort-Object -Unique | Where-Object {
  $_ -notlike 'submission/*' -and $_ -notin $gitlinkPaths -and $_ -ne 'output/pdf/topic3c-adaptive-memory-initial-report-cn.pdf'
})
foreach ($relative in $files) {
  if ($relative -match '(^|/)(node_modules|\.git)(/|$)|(^|/)\.env($|\.(?!example$|sample$|template$))|(^|/)dsapicode\.txt$') {
    throw "Disallowed submission path: $relative"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repo $relative))) {
    throw "Missing required submission file: $relative"
  }
}

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temp = Join-Path $tempBase ("topic3c-package-" + [guid]::NewGuid().ToString("N"))
$stage = Join-Path $temp "stage"
try {
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  $manifest = @()
  foreach ($relative in $files) {
    $source = Join-Path $repo $relative
    $target = Join-Path $stage $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceHash) {
      throw "File changed during packaging: $relative"
    }
    $manifest += [pscustomobject]@{ path = $relative; sha256 = $sourceHash }
  }
  $metadata = [ordered]@{
    protocol = "topic3c-submission-manifest-v1"
    base_commit = (& git -C $repo rev-parse HEAD)
    source = "reviewed working tree; file hashes identify the delivered version"
    omitted_upstream_gitlinks = $gitlinks
    files = $manifest
  }
  $manifestPath = Join-Path $stage "SUBMISSION-MANIFEST.json"
  [System.IO.File]::WriteAllText($manifestPath, ($metadata | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
  New-Item -ItemType Directory -Path (Split-Path $outputPath -Parent) -Force | Out-Null
  # ZipFile preserves dotfiles that Compress-Archive may omit on Windows.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $outputPath)
  $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
  [System.IO.File]::WriteAllText("$outputPath.sha256", "$hash  $([System.IO.Path]::GetFileName($outputPath))`n")
  [pscustomobject]@{ Output = $outputPath; SHA256 = $hash; Bytes = (Get-Item -LiteralPath $outputPath).Length }
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($temp)
  if ($resolvedTemp.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
