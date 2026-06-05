[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'restart', 'down', 'status', 'open', 'help')]
  [string]$Command = 'up',

  [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RunningOnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT

$RootDir = Split-Path -Parent $PSScriptRoot
$BackendEnvFile = Join-Path $RootDir '.env.server'

function Import-EnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      continue
    }

    $pair = $line -split '=', 2
    if ($pair.Count -ne 2) {
      continue
    }

    $name = $pair[0].Trim()
    $value = $pair[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "env:$name" -Value $value
  }
}

Import-EnvFile -Path $BackendEnvFile

$StateDir = if ($env:STITCHLY_STATE_DIR) { $env:STITCHLY_STATE_DIR } else { Join-Path $RootDir '.stitchly' }
$PidDir = Join-Path $StateDir 'pids'
$LogDir = Join-Path $StateDir 'logs'

$BackendPidFile = Join-Path $PidDir 'backend.pid'
$FrontendPidFile = Join-Path $PidDir 'frontend.pid'
$BackendLogFile = Join-Path $LogDir 'backend.log'
$BackendErrorLogFile = Join-Path $LogDir 'backend.err.log'
$FrontendLogFile = Join-Path $LogDir 'frontend.log'
$FrontendErrorLogFile = Join-Path $LogDir 'frontend.err.log'

$BackendHttpUrl = if ($env:STITCHLY_BACKEND_HTTP_URL) { $env:STITCHLY_BACKEND_HTTP_URL } else { 'http://127.0.0.1:3000' }
$UiHttpUrl = if ($env:STITCHLY_UI_HTTP_URL) { $env:STITCHLY_UI_HTTP_URL } else { 'http://127.0.0.1:5173' }
$BackendBindAddr = if ($env:STITCHLY_SERVER_ADDR) { $env:STITCHLY_SERVER_ADDR } else { '127.0.0.1:3000' }
$UiBindHost = if ($env:STITCHLY_UI_HOST) { $env:STITCHLY_UI_HOST } else { '127.0.0.1' }
$UiPort = if ($env:STITCHLY_UI_PORT) { $env:STITCHLY_UI_PORT } else { '5173' }

New-Item -ItemType Directory -Force -Path $PidDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Show-Usage {
  @'
Usage:
  .\scripts\dev_ui_agent.ps1 up [-NoOpen]
  .\scripts\dev_ui_agent.ps1 restart [-NoOpen]
  .\scripts\dev_ui_agent.ps1 down
  .\scripts\dev_ui_agent.ps1 status
  .\scripts\dev_ui_agent.ps1 open

Environment overrides:
  STITCHLY_SERVER_ADDR       Backend bind address. Default: 127.0.0.1:3000
  STITCHLY_BACKEND_HTTP_URL  Backend HTTP URL for health checks. Default: http://127.0.0.1:3000
  STITCHLY_UI_HOST           Frontend bind host. Default: 127.0.0.1
  STITCHLY_UI_PORT           Frontend port. Default: 5173
  STITCHLY_UI_HTTP_URL       Frontend URL for health checks and browser open. Default: http://127.0.0.1:5173
'@ | Write-Host
}

function Read-Pid {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $value = (Get-Content -LiteralPath $Path -Raw).Trim()
  if (-not $value) {
    return $null
  }

  try {
    return [int]$value
  }
  catch {
    return $null
  }
}

function Write-Pid {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  Set-Content -LiteralPath $Path -Value $ProcessId
}

function Test-ProcessRunning {
  param(
    [int]$ProcessId
  )

  if (-not $ProcessId) {
    return $false
  }

  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Clear-StalePidFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $processId = Read-Pid -Path $Path
  if ($processId -and -not (Test-ProcessRunning -ProcessId $processId)) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Test-BackendReady {
  try {
    $nodeDefinitions = Invoke-WebRequest -Uri "$BackendHttpUrl/api/node-definitions" -UseBasicParsing -TimeoutSec 3
    $session = Invoke-WebRequest -Uri "$BackendHttpUrl/api/auth/session" -UseBasicParsing -TimeoutSec 3
    return $nodeDefinitions.Content -match '"node_definitions"' -and $session.Content -match '"authenticated"'
  }
  catch {
    return $false
  }
}

function Test-FrontendReady {
  try {
    $response = Invoke-WebRequest -Uri $UiHttpUrl -UseBasicParsing -TimeoutSec 3
    return $response.Content -match '<title>Stitchly</title>'
  }
  catch {
    return $false
  }
}

function Wait-ForReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Check,
    [Parameter(Mandatory = $true)]
    [string]$LogFile,
    [string]$ErrorLogFile,
    [string]$PidFile,
    [int]$Attempts = 60
  )

  for ($count = 0; $count -lt $Attempts; $count++) {
    if (& $Check) {
      return
    }

    if ($PidFile) {
      $trackedPid = Read-Pid -Path $PidFile
      if ($trackedPid -and -not (Test-ProcessRunning -ProcessId $trackedPid)) {
        Write-Host "$Label process exited before it became ready."
        if (Test-Path -LiteralPath $LogFile) {
          Write-Host ""
          Write-Host "Last lines from ${LogFile}:"
          Get-Content -LiteralPath $LogFile -Tail 40
        }
        if ($ErrorLogFile -and (Test-Path -LiteralPath $ErrorLogFile)) {
          Write-Host ""
          Write-Host "Last lines from ${ErrorLogFile}:"
          Get-Content -LiteralPath $ErrorLogFile -Tail 40
        }
        throw "$Label failed to start."
      }
    }

    Start-Sleep -Seconds 1
  }

  Write-Host "$Label did not become ready in time."
  if (Test-Path -LiteralPath $LogFile) {
    Write-Host ""
    Write-Host "Last lines from ${LogFile}:"
    Get-Content -LiteralPath $LogFile -Tail 40
  }
  if ($ErrorLogFile -and (Test-Path -LiteralPath $ErrorLogFile)) {
    Write-Host ""
    Write-Host "Last lines from ${ErrorLogFile}:"
    Get-Content -LiteralPath $ErrorLogFile -Tail 40
  }
  throw "$Label readiness timed out."
}

function Get-OptionalEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $item = Get-Item -Path "env:$Name" -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    return $null
  }

  return $item.Value
}

function Get-CargoFallbackPaths {
  $paths = [System.Collections.Generic.List[string]]::new()

  if ($env:CARGO_HOME) {
    $paths.Add((Join-Path $env:CARGO_HOME 'bin\cargo.exe'))
  }

  $paths.Add((Join-Path $HOME '.cargo\bin\cargo.exe'))
  return $paths.ToArray()
}

function Get-CorepackFallbackPaths {
  $paths = [System.Collections.Generic.List[string]]::new()
  $programFilesX86 = Get-OptionalEnvValue -Name 'ProgramFiles(x86)'

  foreach ($baseDir in @($env:ProgramFiles, $programFilesX86)) {
    if (-not $baseDir) {
      continue
    }

    $paths.Add((Join-Path $baseDir 'nodejs\corepack.cmd'))
    $paths.Add((Join-Path $baseDir 'nodejs\corepack.exe'))
  }

  return $paths.ToArray()
}

function Get-CommandPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string[]]$FallbackPaths = @(),
    [string]$InstallHint = ''
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($path in $FallbackPaths) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      return $path
    }
  }

  $messageLines = [System.Collections.Generic.List[string]]::new()
  $messageLines.Add("Could not find required command '$Name'.")

  if ($FallbackPaths.Count -gt 0) {
    $messageLines.Add('Checked these fallback locations:')
    foreach ($path in $FallbackPaths) {
      if ($path) {
        $messageLines.Add("  - $path")
      }
    }
  }

  if ($InstallHint) {
    $messageLines.Add($InstallHint)
  }

  throw ($messageLines -join [Environment]::NewLine)
}

function Invoke-NativeCommandToLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [Parameter(Mandatory = $true)]
    [string]$LogFile,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [string]$WorkingDirectory = $RootDir
  )

  $stdoutLogFile = "$LogFile.stdout.tmp"
  $stderrLogFile = "$LogFile.stderr.tmp"

  Remove-Item -LiteralPath $LogFile, $stdoutLogFile, $stderrLogFile -Force -ErrorAction SilentlyContinue

  try {
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdoutLogFile -RedirectStandardError $stderrLogFile -WindowStyle Hidden -Wait -PassThru
    if (Test-Path -LiteralPath $stdoutLogFile) {
      Get-Content -LiteralPath $stdoutLogFile | Add-Content -LiteralPath $LogFile
    }
    if (Test-Path -LiteralPath $stderrLogFile) {
      Get-Content -LiteralPath $stderrLogFile | Add-Content -LiteralPath $LogFile
    }
    $exitCode = $process.ExitCode
  }
  finally {
    Remove-Item -LiteralPath $stdoutLogFile, $stderrLogFile -Force -ErrorAction SilentlyContinue
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage Exit code: $exitCode. See log: $LogFile"
  }
}

function Get-VswherePath {
  $vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswherePath) {
    return $vswherePath
  }

  return $null
}

function Get-MsvcBuildToolsInstallPath {
  $vswherePath = Get-VswherePath
  if (-not $vswherePath) {
    return $null
  }

  $installationPath = & $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($installationPath) {
    return $installationPath.Trim()
  }

  return $null
}

function Show-MsvcInstallHint {
  $linkCommand = Get-Command 'link.exe' -ErrorAction SilentlyContinue
  if ($linkCommand) {
    return
  }

  $messageLines = [System.Collections.Generic.List[string]]::new()
  $messageLines.Add("Could not find MSVC linker 'link.exe'.")
  $messageLines.Add('The Windows Rust MSVC toolchain needs Visual Studio Build Tools with the C++ workload.')
  $messageLines.Add('')
  if (Get-Command 'winget' -ErrorAction SilentlyContinue) {
    $messageLines.Add('Install it with:')
    $messageLines.Add('  winget install --id Microsoft.VisualStudio.2022.BuildTools -e')
  }
  elseif (Test-Path -LiteralPath (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe')) {
    $messageLines.Add('Download and run the Build Tools bootstrapper:')
    $messageLines.Add('  https://aka.ms/vs/17/release/vs_BuildTools.exe')
    $messageLines.Add('')
    $messageLines.Add('Then install with:')
    $messageLines.Add('  .\vs_BuildTools.exe --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart')
  }
  else {
    $messageLines.Add('Install Visual Studio Build Tools 2022 from:')
    $messageLines.Add('  https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022')
  }
  $messageLines.Add('')
  $messageLines.Add('Then open Visual Studio Installer and add:')
  $messageLines.Add('  - Desktop development with C++')
  $messageLines.Add('  - MSVC v143 C++ build tools')
  $messageLines.Add('  - Windows 10/11 SDK')
  $messageLines.Add('')
  $messageLines.Add('After installation, restart PowerShell and run this script again.')

  throw ($messageLines -join [Environment]::NewLine)
}

function Import-MsvcBuildEnvironment {
  if (Get-Command 'link.exe' -ErrorAction SilentlyContinue) {
    return
  }

  $installPath = Get-MsvcBuildToolsInstallPath
  if (-not $installPath) {
    Show-MsvcInstallHint
  }

  $vsDevCmd = Join-Path $installPath 'Common7\Tools\VsDevCmd.bat'
  if (-not (Test-Path -LiteralPath $vsDevCmd)) {
    throw "Could not find Visual Studio developer environment script at $vsDevCmd"
  }

  Write-Host "Loading MSVC build environment from $installPath"
  $environmentLines = & $env:ComSpec /d /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 > nul && set"
  foreach ($line in $environmentLines) {
    $pair = $line -split '=', 2
    if ($pair.Count -eq 2) {
      Set-Item -Path "env:$($pair[0])" -Value $pair[1]
    }
  }

  if (-not (Get-Command 'link.exe' -ErrorAction SilentlyContinue)) {
    throw "Loaded Visual Studio build environment, but 'link.exe' is still unavailable on PATH."
  }
}

function Start-Backend {
  Clear-StalePidFile -Path $BackendPidFile

  if (Test-BackendReady) {
    Write-Host "Backend already available at $BackendHttpUrl"
    return
  }

  $existingPid = Read-Pid -Path $BackendPidFile
  if (Test-ProcessRunning -ProcessId $existingPid) {
    Write-Host "Stopping stale backend process $existingPid before restart."
    Stop-ManagedProcess -Label 'Backend' -PidFile $BackendPidFile
  }

  Write-Host "Starting backend on $BackendBindAddr"
  $cargoPath = Get-CommandPath -Name 'cargo' -FallbackPaths (Get-CargoFallbackPaths) -InstallHint 'Install the native Windows Rust toolchain from https://rustup.rs/ or make sure cargo.exe is available on PATH.'
  Import-MsvcBuildEnvironment
  Invoke-NativeCommandToLog -FilePath $cargoPath -ArgumentList @('build', '-p', 'runtime_server', '--bin', 'stitchly-server') -LogFile $BackendLogFile -FailureMessage 'Backend build failed.'

  $backendExe = Join-Path $RootDir 'target\debug\stitchly-server.exe'
  if (-not (Test-Path -LiteralPath $backendExe)) {
    throw "Backend executable not found at $backendExe"
  }

  $env:STITCHLY_SERVER_ADDR = $BackendBindAddr
  Remove-Item -LiteralPath $BackendLogFile, $BackendErrorLogFile -Force -ErrorAction SilentlyContinue
  $backendProcess = Start-Process -FilePath $backendExe -WorkingDirectory $RootDir -RedirectStandardOutput $BackendLogFile -RedirectStandardError $BackendErrorLogFile -WindowStyle Hidden -PassThru
  Write-Pid -Path $BackendPidFile -ProcessId $backendProcess.Id

  Wait-ForReady -Label 'Backend' -Check ${function:Test-BackendReady} -LogFile $BackendLogFile -ErrorLogFile $BackendErrorLogFile -PidFile $BackendPidFile
}

function Start-Frontend {
  Clear-StalePidFile -Path $FrontendPidFile

  if (Test-FrontendReady) {
    Write-Host "Frontend already available at $UiHttpUrl"
    return
  }

  $existingPid = Read-Pid -Path $FrontendPidFile
  if (Test-ProcessRunning -ProcessId $existingPid) {
    Write-Host "Waiting for existing frontend process $existingPid to become ready..."
    Wait-ForReady -Label 'Frontend' -Check ${function:Test-FrontendReady} -LogFile $FrontendLogFile -ErrorLogFile $FrontendErrorLogFile -PidFile $FrontendPidFile
    return
  }

  Write-Host "Starting frontend on $UiBindHost`:$UiPort"
  $env:STITCHLY_API_PROXY = $BackendHttpUrl
  $corepackPath = Get-CommandPath -Name 'corepack' -FallbackPaths (Get-CorepackFallbackPaths) -InstallHint 'Install native Windows Node.js (which includes corepack) or add corepack.cmd to PATH.'
  Remove-Item -LiteralPath $FrontendLogFile, $FrontendErrorLogFile -Force -ErrorAction SilentlyContinue
  $frontendProcess = Start-Process -FilePath $corepackPath -ArgumentList @('pnpm', '--dir', 'apps/web', 'dev', '--host', $UiBindHost, '--port', $UiPort, '--strictPort') -WorkingDirectory $RootDir -RedirectStandardOutput $FrontendLogFile -RedirectStandardError $FrontendErrorLogFile -WindowStyle Hidden -PassThru
  Write-Pid -Path $FrontendPidFile -ProcessId $frontendProcess.Id

  Wait-ForReady -Label 'Frontend' -Check ${function:Test-FrontendReady} -LogFile $FrontendLogFile -ErrorLogFile $FrontendErrorLogFile -PidFile $FrontendPidFile
}

function Open-Ui {
  if (-not (Test-FrontendReady)) {
    Write-Host "Frontend is not reachable at $UiHttpUrl yet."
    throw "Frontend not ready."
  }

  Start-Process $UiHttpUrl | Out-Null
  Write-Host "Opened $UiHttpUrl"
}

function Stop-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$PidFile
  )

  Clear-StalePidFile -Path $PidFile
  $processId = Read-Pid -Path $PidFile

  if (-not (Test-ProcessRunning -ProcessId $processId)) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "$Label is not running."
    return
  }

  Write-Host "Stopping $Label process $processId"
  if ($RunningOnWindows) {
    & taskkill.exe /PID $processId /T /F | Out-Null
  }
  else {
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
  }

  for ($count = 0; $count -lt 10; $count++) {
    if (-not (Test-ProcessRunning -ProcessId $processId)) {
      break
    }
    Start-Sleep -Seconds 1
  }

  if (Test-ProcessRunning -ProcessId $processId) {
    Write-Host "Force stopping $Label process $processId"
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-Agent {
  Stop-ManagedProcess -Label 'Frontend' -PidFile $FrontendPidFile
  Stop-ManagedProcess -Label 'Backend' -PidFile $BackendPidFile
}

function Show-Status {
  Clear-StalePidFile -Path $BackendPidFile
  Clear-StalePidFile -Path $FrontendPidFile

  $backendProcessId = Read-Pid -Path $BackendPidFile
  $frontendProcessId = Read-Pid -Path $FrontendPidFile

  Write-Host 'Backend:'
  if (Test-BackendReady) {
    Write-Host '  status: ready'
    Write-Host "  url:    $BackendHttpUrl"
  }
  elseif (Test-ProcessRunning -ProcessId $backendProcessId) {
    Write-Host '  status: starting'
    Write-Host "  pid:    $backendProcessId"
  }
  else {
    Write-Host '  status: stopped'
  }
  Write-Host "  log:    $BackendLogFile"

  Write-Host ''
  Write-Host 'Frontend:'
  if (Test-FrontendReady) {
    Write-Host '  status: ready'
    Write-Host "  url:    $UiHttpUrl"
  }
  elseif (Test-ProcessRunning -ProcessId $frontendProcessId) {
    Write-Host '  status: starting'
    Write-Host "  pid:    $frontendProcessId"
  }
  else {
    Write-Host '  status: stopped'
  }
  Write-Host "  log:    $FrontendLogFile"
}

function Start-Agent {
  Start-Backend
  Start-Frontend

  Write-Host ''
  Write-Host "Stitchly UI is ready at $UiHttpUrl"
  Write-Host "Backend API is ready at $BackendHttpUrl"
  Write-Host 'Logs:'
  Write-Host "  backend:  $BackendLogFile"
  Write-Host "  frontend: $FrontendLogFile"

  if (-not $NoOpen) {
    Write-Host ''
    try {
      Open-Ui
    }
    catch {
      Write-Host "Could not auto-open the UI from this environment."
      Write-Host "Open this URL manually: $UiHttpUrl"
    }
  }
}

try {
  switch ($Command) {
    'up' {
      Start-Agent
    }
    'restart' {
      Stop-Agent
      Start-Agent
    }
    'down' {
      Stop-Agent
    }
    'status' {
      Show-Status
    }
    'open' {
      Open-Ui
    }
    'help' {
      Show-Usage
    }
  }
}
catch {
  Write-Host $_.Exception.Message
  exit 1
}
