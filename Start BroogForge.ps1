param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$StatePath = Join-Path $Root 'data\server.json'
if (Test-Path -LiteralPath $StatePath) {
    $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    try {
        $Result = Invoke-RestMethod -Uri "$($State.url)/api/system" -TimeoutSec 2
        if ($null -ne $Result.busy) { if (-not $NoOpen) { Start-Process $State.url }; exit }
    } catch {}
}
$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) {
    $Node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $Node)) { throw 'Node.js 22 or newer is required.' }
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
$ServerScript = Join-Path $Root 'server\index.js'
$Process = Start-Process -FilePath $Node -ArgumentList @('"' + $ServerScript + '"') -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root 'data\server.log') -RedirectStandardError (Join-Path $Root 'data\server-error.log')
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 200
    if ($Process.HasExited) { throw 'BroogForge could not start. See data/server-error.log.' }
    if (Test-Path -LiteralPath $StatePath) {
        $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        if ($State.pid -eq $Process.Id) { if (-not $NoOpen) { Start-Process $State.url }; exit }
    }
}
throw 'Startup is taking longer than expected. See data/server.log.'
