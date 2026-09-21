$StatePath = Join-Path $PSScriptRoot 'data\server.json'
if (Test-Path -LiteralPath $StatePath) {
    $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "$($State.url)/api/shutdown" | Out-Null
    Write-Host 'BroogForge shutdown requested. Active generation will be cancelled.'
} else { Write-Host 'BroogForge is not running.' }
