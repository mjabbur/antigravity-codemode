$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RipwireVersion = "0.6.5"

# Determine repository root from script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path

# Validate operating system architecture
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Error: Ripwire pre-built binaries require a 64-bit Windows operating system."
}

$Platform = "windows-x64"
$TargetDir = Join-Path $RepoRoot "bin\ripwire-$RipwireVersion-$Platform"
$BinPath = Join-Path $TargetDir "ripwire.exe"

# Idempotency check: verify if binary already exists and matches target version
if (Test-Path -Path $BinPath -PathType Leaf) {
    try {
        $installedVersion = & $BinPath --version 2>$null
        if ($installedVersion -like "ripwire $RipwireVersion *") {
            Write-Host "Ripwire v$RipwireVersion is already installed at: $BinPath"
            & $BinPath --version
            $jsonBinPath = $BinPath -replace '\\', '/'
            Write-Host ""
            Write-Host "Configuration for mcp_config.json:"
            Write-Host "  `"RIPWIRE_PATH`": `"$jsonBinPath`""
            exit 0
        }
    } catch {
        # If binary execution failed, proceed with reinstallation
    }
}

$BaseUrl = "https://github.com/redhat-et/ripwire/releases/download/v$RipwireVersion"
$ArchiveName = "ripwire-$RipwireVersion-$Platform.zip"
$ShaName = "$ArchiveName.sha256"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    $ArchiveFile = Join-Path $TempDir $ArchiveName
    $ShaFile = Join-Path $TempDir $ShaName

    Write-Host "Downloading Ripwire v$RipwireVersion ($Platform)..."
    Invoke-WebRequest -Uri "$BaseUrl/$ArchiveName" -OutFile $ArchiveFile
    Invoke-WebRequest -Uri "$BaseUrl/$ShaName" -OutFile $ShaFile

    # Read expected hash from sha256 file
    $shaFileContent = Get-Content -Path $ShaFile -Raw
    $expectedHash = ($shaFileContent.Trim() -split '\s+')[0].Trim()

    # Allow test override for checksum failure simulation
    $testHashOverride = if ($env:RIPWIRE_INSTALL_TEST_HASH_OVERRIDE) { $env:RIPWIRE_INSTALL_TEST_HASH_OVERRIDE } else { $env:TEST_RIPWIRE_EXPECTED_HASH }
    if ($testHashOverride) {
        Write-Host "Applying test hash override: $testHashOverride"
        $expectedHash = $testHashOverride.Trim()
    }

    Write-Host "Verifying SHA256 checksum..."
    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $ArchiveFile).Hash.Trim()

    if ($actualHash -ne $expectedHash) {
        throw "Error: SHA256 checksum verification failed for $ArchiveName!`nExpected: $expectedHash`nActual:   $actualHash`nAborting installation without extracting."
    }

    Write-Host "SHA256 checksum verified."

    $BinDir = Join-Path $RepoRoot "bin"
    if (-not (Test-Path -Path $BinDir)) {
        New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    }

    Write-Host "Extracting $ArchiveName to $TargetDir..."
    Expand-Archive -Path $ArchiveFile -DestinationPath $BinDir -Force

    if (-not (Test-Path -Path $BinPath -PathType Leaf)) {
        throw "Error: Binary not found at $BinPath after extraction."
    }

    Write-Host "Ripwire v$RipwireVersion installed successfully."
    & $BinPath --version

    $jsonBinPath = $BinPath -replace '\\', '/'
    Write-Host ""
    Write-Host "Configuration for mcp_config.json:"
    Write-Host "  `"RIPWIRE_PATH`": `"$jsonBinPath`""
}
finally {
    if (Test-Path -Path $TempDir) {
        Remove-Item -Recurse -Force -Path $TempDir -ErrorAction SilentlyContinue
    }
}
