param([string]$OutputDirectory, [string]$InputFile, [string]$ReportFile)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($OutputDirectory)
$files = @()
foreach ($relative in (Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json)) {
  $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid artifact path' }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  $item = Get-Item -LiteralPath $file
  $files += [ordered]@{file=$relative; status=[string]$signature.Status; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(); fileVersion=$item.VersionInfo.FileVersion; publisher=$null; timestamp=$null}
}
$invalid = @($files | Where-Object { $_.status -notin @('NotSigned', 'Valid') })
$report = [ordered]@{state='unsigned_candidate'; signingEnabled=$false; passed=($invalid.Count -eq 0); files=$files; uninstallRuntimeVerification='not_executed'; windowsInstallAcceptance='not_executed'}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportFile -Encoding UTF8
