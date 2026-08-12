param(
    [string]$OutputPath = "RIOH_SITEGROUND.zip"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = Join-Path $projectRoot $OutputPath

$publicFiles = @(
    ".htaccess",
    "admin.html",
    "admin.js",
    "apple-touch-icon.png",
    "burger1.webp",
    "cheddar_soul.webp",
    "crunchy_byte.webp",
    "favicon.png",
    "fondo01.jpg",
    "fonts.css",
    "archivo-black-latin.woff2",
    "inter-latin.woff2",
    "OFL.txt",
    "outfit-latin.woff2",
    "syne-latin.woff2",
    "fresh_bloom.webp",
    "index.html",
    "main.js",
    "malbec_rich.webp",
    "nueva1.webp",
    "nuevaDESIGN.webp",
    "nuggets.webp",
    "papas.webp",
    "style.css",
    "jspdf.plugin.autotable.min.js",
    "jspdf.umd.min.js",
    "lucide.min.js",
    "qz-tray.js",
    "supabase.min.js",
    "versionmobile.webp"
)

foreach ($relativePath in $publicFiles) {
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Falta un archivo obligatorio: $relativePath"
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Force
}

$archive = [System.IO.Compression.ZipFile]::Open(
    $resolvedOutput,
    [System.IO.Compression.ZipArchiveMode]::Create
)

try {
    foreach ($relativePath in $publicFiles) {
        $sourcePath = Join-Path $projectRoot $relativePath
        $entryName = $relativePath.Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $sourcePath,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}

$verificationArchive = [System.IO.Compression.ZipFile]::OpenRead($resolvedOutput)
try {
    $entryNames = @($verificationArchive.Entries | ForEach-Object FullName)
    $missingEntries = @($publicFiles | Where-Object { $_ -notin $entryNames })
    $invalidEntries = @($entryNames | Where-Object { $_ -match "[\\/]" })

    if ($missingEntries.Count -gt 0) {
        throw "El ZIP no contiene: $($missingEntries -join ', ')"
    }
    if ($invalidEntries.Count -gt 0) {
        throw "El ZIP contiene rutas que no son planas: $($invalidEntries -join ', ')"
    }
    if ($entryNames.Count -ne $publicFiles.Count) {
        throw "Cantidad inesperada de archivos en el ZIP: $($entryNames.Count)"
    }
} finally {
    $verificationArchive.Dispose()
}

$hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash
Write-Output "Paquete: $resolvedOutput"
Write-Output "Archivos: $($publicFiles.Count)"
Write-Output "SHA256: $hash"
