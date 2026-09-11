[CmdletBinding()]
param(
  [string]$Output = "submission/topic3c-final-20260911-delivery.zip"
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

$overlay = @(
  "README.md",
  "SUBMISSION.md",
  "MemoryCore/package.json",
  "MemoryCore/scripts/topic3-c/final-confidence-replay.ts",
  "docs/topic3c/report/render_final_report.py",
  "docs/topic3c/RESULTS.md",
  "docs/topic3c/EXPERIMENT_HISTORY.md",
  "docs/topic3c/CLEANROOM.md",
  "results/initial-results.json",
  "results/long-dialog-action-table.json",
  "results/final-confidence-replay.json",
  "output/pdf/topic3c-adaptive-memory-final-report-cn.pdf",
  "scripts/package-topic3c.ps1"
)
foreach ($relative in $overlay) {
  if (-not (Test-Path -LiteralPath (Join-Path $repo $relative))) {
    throw "Missing required submission file: $relative"
  }
}

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temp = Join-Path $tempBase ("topic3c-package-" + [guid]::NewGuid().ToString("N"))
$stage = Join-Path $temp "stage"
$baseZip = Join-Path $temp "base.zip"
try {
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  & git -C $repo archive --format=zip HEAD -o $baseZip
  if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
  Expand-Archive -LiteralPath $baseZip -DestinationPath $stage
  $obsoleteReport = Join-Path $stage "output/pdf/topic3c-adaptive-memory-initial-report-cn.pdf"
  $resolvedObsoleteReport = [System.IO.Path]::GetFullPath($obsoleteReport)
  $resolvedStage = [System.IO.Path]::GetFullPath($stage)
  if ($resolvedObsoleteReport.StartsWith($resolvedStage + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedObsoleteReport)) {
    Remove-Item -LiteralPath $resolvedObsoleteReport -Force
  }
  foreach ($relative in $overlay) {
    $target = Join-Path $stage $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo $relative) -Destination $target -Force
  }
  New-Item -ItemType Directory -Path (Split-Path $outputPath -Parent) -Force | Out-Null
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $outputPath -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
  [pscustomobject]@{ Output = $outputPath; SHA256 = $hash; Bytes = (Get-Item -LiteralPath $outputPath).Length }
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($temp)
  if ($resolvedTemp.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
