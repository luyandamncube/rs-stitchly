[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'restart', 'down', 'status', 'open', 'help')]
  [string]$Command = 'up',

  [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
$FrontendLogFile = Join-Path $LogDir 'frontend.log'

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
          Write-Host "Last lines from $LogFile:"
          Get-Content -LiteralPath $LogFile -Tail 40
        }
        throw "$Label failed to start."
      }
    }

    Start-Sleep -Seconds 1
  }

  Write-Host "$Label did not become ready in time."
  if (Test-Path -LiteralPath $LogFile) {
    Write-Host ""
    Write-Host "Last lines from $LogFile:"
    Get-Content -LiteralPath $LogFile -Tail 40
  }
  throw "$Label readiness timed out."
}

function Get-CommandPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Could not find required command: $Name"
  }

  return $command.Source
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
  $cargoPath = Get-CommandPath -Name 'cargo'
  & $cargoPath build -p runtime_server --bin stitchly-server *> $BackendLogFile

  $backendExe = Join-Path $RootDir 'target\debug\stitchly-server.exe'
  if (-not (Test-Path -LiteralPath $backendExe)) {
    throw "Backend executable not found at $backendExe"
  }

  $env:STITCHLY_SERVER_ADDR = $BackendBindAddr
  $backendProcess = Start-Process -FilePath $backendExe -WorkingDirectory $RootDir -RedirectStandardOutput $BackendLogFile -RedirectStandardError $BackendLogFile -WindowStyle Hidden -PassThru
  Write-Pid -Path $BackendPidFile -ProcessId $backendProcess.Id

  Wait-ForReady -Label 'Backend' -Check ${function:Test-BackendReady} -LogFile $BackendLogFile -PidFile $BackendPidFile
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
    Wait-ForReady -Label 'Frontend' -Check ${function:Test-FrontendReady} -LogFile $FrontendLogFile -PidFile $FrontendPidFile
    return
  }

  Write-Host "Starting frontend on $UiBindHost`:$UiPort"
  $env:STITCHLY_API_PROXY = $BackendHttpUrl
  $corepackPath = Get-CommandPath -Name 'corepack'
  $frontendProcess = Start-Process -FilePath $corepackPath -ArgumentList @('pnpm', '--dir', 'apps/web', 'dev', '--host', $UiBindHost, '--port', $UiPort, '--strictPort') -WorkingDirectory $RootDir -RedirectStandardOutput $FrontendLogFile -RedirectStandardError $FrontendLogFile -WindowStyle Hidden -PassThru
  Write-Pid -Path $FrontendPidFile -ProcessId $frontendProcess.Id

  Wait-ForReady -Label 'Frontend' -Check ${function:Test-FrontendReady} -LogFile $FrontendLogFile -PidFile $FrontendPidFile
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
  Stop-Process -Id $processId -ErrorAction SilentlyContinue

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
