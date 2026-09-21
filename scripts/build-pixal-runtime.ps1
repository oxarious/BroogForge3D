$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Cache = Join-Path $Root 'runtime/build-cache'
$Cuda = Join-Path $Root 'runtime/cuda-toolkit'
New-Item -ItemType Directory -Force -Path $Cache,$Cuda | Out-Null
$Manifest = Invoke-RestMethod 'https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.1.0.json'
foreach ($Name in @('cuda_nvcc','libnvvm','cuda_cudart','cuda_cccl','cuda_crt','libcublas')) {
    $Artifact = $Manifest.$Name.'windows-x86_64'
    if (-not $Artifact.relative_path -or -not $Artifact.sha256) { throw "No verified Windows artifact: $Name" }
    $Zip = Join-Path $Cache "$Name.zip"
    if (-not (Test-Path -LiteralPath $Zip)) {
        Write-Host "Downloading CUDA component: $Name"
        & curl.exe --fail --location --silent --show-error --retry 3 --output "$Zip.part" "https://developer.download.nvidia.com/compute/cuda/redist/$($Artifact.relative_path)"
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
        if ((Get-FileHash -LiteralPath "$Zip.part" -Algorithm SHA256).Hash -ne $Artifact.sha256) { throw "Checksum mismatch: $Name" }
        Move-Item -LiteralPath "$Zip.part" -Destination $Zip
    }
    if ((Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash -ne $Artifact.sha256) { throw "Checksum mismatch: $Name" }
    $Unpack = Join-Path $Cache $Name
    if (-not (Test-Path -LiteralPath $Unpack)) { Expand-Archive -LiteralPath $Zip -DestinationPath $Unpack }
    $Content = Get-ChildItem -LiteralPath $Unpack -Directory | Select-Object -First 1
    Get-ChildItem -LiteralPath $Content.FullName | Copy-Item -Destination $Cuda -Recurse -Force
}
$env:BROOG_ROOT = $Root
$env:CUDA_PATH = $Cuda
$env:CUDACXX = Join-Path $Cuda 'bin/nvcc.exe'
$env:PATH = "$(Join-Path $Root 'runtime/unirig-env/Scripts');$(Join-Path $Cuda 'bin');$env:PATH"
& cmd.exe /d /c (Join-Path $PSScriptRoot 'build-pixal-runtime.cmd')
if ($LASTEXITCODE -ne 0) { throw 'Pixal3D runtime build failed. See compiler output.' }
$Output = Join-Path $Root 'runtime/pixal-cuda'
New-Item -ItemType Directory -Force -Path $Output | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'runtime/pixal-build/trellis-cli.exe') -Destination $Output
Get-ChildItem (Join-Path $Root 'runtime/pixal-build') -Filter '*.dll' | Copy-Item -Destination $Output -Force
Get-ChildItem -LiteralPath $Cuda -Filter '*.dll' -Recurse | Where-Object { $_.Name -match '^(cudart|cublas)' } | Copy-Item -Destination $Output -Force
& (Join-Path $Output 'trellis-cli.exe') --help
if ($LASTEXITCODE -ne 0) { throw 'Built runtime failed its help check.' }
