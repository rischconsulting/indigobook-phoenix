param(
    [string]$SourceDir = $PSScriptRoot,
    [string]$OutputBaseName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Build ---
Write-Host "Building bundle..." -ForegroundColor Cyan
& c:\esbuild\esbuild.exe lib\main.mjs --bundle --format=iife --global-name=IndigoBookCSLM --platform=browser --outfile=content\indigobook-cslm.js
if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }
Write-Host "Build complete." -ForegroundColor Cyan

# --- Package ---
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$sourcePath = (Resolve-Path -Path $SourceDir).Path

if ([string]::IsNullOrWhiteSpace($OutputBaseName)) {
    $manifestPath = Join-Path -Path $sourcePath -ChildPath 'manifest.json'
    if (Test-Path -Path $manifestPath) {
        try {
            $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
            $manifestName = [string]($manifest.name)
            $manifestVersion = [string]($manifest.version)

            $slug = $manifestName.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
            $slug = $slug.Trim('-')

            if (-not [string]::IsNullOrWhiteSpace($slug) -and -not [string]::IsNullOrWhiteSpace($manifestVersion)) {
                $OutputBaseName = "$slug-$manifestVersion"
            }
            elseif (-not [string]::IsNullOrWhiteSpace($slug)) {
                $OutputBaseName = $slug
            }
        }
        catch {
            # Fall back to folder name if manifest parsing fails.
        }
    }

    if ([string]::IsNullOrWhiteSpace($OutputBaseName)) {
        $OutputBaseName = Split-Path -Leaf $sourcePath
    }
}

$zipPath = Join-Path -Path $sourcePath -ChildPath ("{0}.zip" -f $OutputBaseName)
$xpiPath = Join-Path -Path $sourcePath -ChildPath ("{0}.xpi" -f $OutputBaseName)

Write-Host "Source: $sourcePath"
Write-Host "Zip:    $zipPath"
Write-Host "XPI:    $xpiPath"

if (Test-Path -Path $zipPath) { Remove-Item -Path $zipPath -Force }
if (Test-Path -Path $xpiPath) { Remove-Item -Path $xpiPath -Force }

$zipName = Split-Path -Leaf $zipPath
$xpiName = Split-Path -Leaf $xpiPath

$filesToArchive = Get-ChildItem -Path $sourcePath -File -Recurse -Force |
    Where-Object {
        $full = $_.FullName
        $rel = $full.Substring($sourcePath.Length).TrimStart('\','/')

        # Exclude VCS dir and output artifacts
        if ($rel -match '^(\.git[\\/]|\.git$)') { return $false }
        if ($rel -ieq $zipName -or $rel -ieq $xpiName) { return $false }

        # Exclude script helpers from package
        if ($_.Extension -ieq '.ps1' -or $_.Extension -ieq '.bat') { return $false }

        return $true
    }

if (-not $filesToArchive) { throw "No files found to archive in $sourcePath" }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $filesToArchive) {
        $entryName = $file.FullName.Substring($sourcePath.Length).TrimStart('\','/') -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $file.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
}
finally {
    $zip.Dispose()
}

Move-Item -Path $zipPath -Destination $xpiPath

Write-Host "Created package: $xpiPath" -ForegroundColor Green
