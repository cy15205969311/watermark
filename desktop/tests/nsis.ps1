param([switch]$LiveGaoding)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildRoot = Join-Path $projectRoot '.desktop-build'
$installTarget = [IO.Path]::GetFullPath((Join-Path $buildRoot ('NSIS 中文 安装 ' + [guid]::NewGuid().ToString('N'))))
if (-not $installTarget.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid NSIS test target' }
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "release/DesignExtractor-Personal-$version-x64-Setup.exe"
$stateFile = Join-Path $buildRoot 'nsis-retention-state.json'
function Invoke-Installer {
  $process = Start-Process -FilePath $installer -ArgumentList "/S /D=$installTarget" -WindowStyle Hidden -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit(60000)) { throw 'NSIS install timed out' }
  if ($process.ExitCode -ne 0) { throw "NSIS install failed: $($process.ExitCode)" }
}
Push-Location $projectRoot
try {
  Invoke-Installer
  $installedExe = Join-Path $installTarget '设计稿提取助手.exe'
  if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Installed executable missing' }
  $arguments = @('desktop/tests/packaged.cjs', "--installed=$installTarget")
  if ($LiveGaoding) { $arguments += '--live-gaoding' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed' }
  & node desktop/tests/nsis-state.cjs seed $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Retention fixture failed' }
  Invoke-Installer
  & node desktop/tests/nsis-state.cjs verify $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Reinstall did not preserve history' }
  $uninstallers = @(Get-ChildItem -LiteralPath $installTarget -Filter '*Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) { throw 'Expected one uninstaller' }
  $uninstaller = [IO.Path]::GetFullPath($uninstallers[0].FullName)
  if (-not $uninstaller.StartsWith($installTarget + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid uninstaller target' }
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit(60000)) { throw 'NSIS uninstall timed out' }
  if ($process.ExitCode -ne 0) { throw "NSIS uninstall failed: $($process.ExitCode)" }
  # NSIS copies its uninstaller to temp and may finish asynchronously.
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ((Test-Path -LiteralPath $installedExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $installedExe) { throw 'Application files remain after uninstall' }
  & node desktop/tests/nsis-state.cjs clean $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Uninstall did not preserve user database/config' }
  $result = @{ installTarget = $installTarget; install = 'passed'; installedApp = 'passed'; sameVersionReinstall = 'passed'; uninstall = 'passed'; userDataRetained = 'passed'; differentVersionUpgrade = 'not executed'; cleanWindowsVM = 'not executed' }
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'server/test-artifacts/desktop-nsis-results.json') -Encoding utf8
  $result | ConvertTo-Json
} finally { Pop-Location }
