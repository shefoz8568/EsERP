# EsERP — Windows one-command setup
#
# Run from the repo root in PowerShell:
#   .\setup-windows.ps1
# Or double-click setup-windows.bat (it calls this script with
# -ExecutionPolicy Bypass).
#
# What it does:
#   1. Checks prerequisites (Node 20+, pnpm via corepack, Docker Desktop running)
#   2. Copies .env.example -> .env if .env is missing
#   3. Starts Postgres / Redis / MinIO / MailHog with Docker Compose
#   4. Installs dependencies, runs migrations + seed (owner URL)
#   5. Prints the app URLs and the demo login
#
# It stops on the first failure and prints a plain-English hint for the
# common causes. Nothing here needs WSL or bash.
# NOTE: this script was reviewed, not executed, on Linux — see docs/handover.md.

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) {
    Write-Host "`nFAILED: $msg" -ForegroundColor Red
    exit 1
}

# --- 0. Repo root (the script lives there) ----------------------------------
Set-Location $PSScriptRoot

# --- 1. Prerequisites --------------------------------------------------------
Write-Step "Checking prerequisites"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Fail "Node.js was not found. Install Node.js LTS (20+) from https://nodejs.org, close this window, reopen PowerShell and run the script again."
}
$nodeVersion = (node --version) -replace "^v", ""
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
    Write-Fail "Node.js $nodeVersion is too old. EsERP needs Node.js 20 or newer. Install Node.js LTS from https://nodejs.org and run the script again."
}
Write-Ok "Node.js v$nodeVersion"

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Step "pnpm not found — enabling it via corepack (ships with Node.js)"
    try {
        corepack enable
        corepack prepare pnpm@9 --activate
    } catch {
        Write-Fail "Could not enable pnpm via corepack. Try running PowerShell as Administrator once, then run the script again."
    }
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) { Write-Fail "pnpm is still not available after corepack enable. Close PowerShell, reopen it and run the script again." }
}
Write-Ok "pnpm $(pnpm --version)"

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Fail "Docker was not found. Install Docker Desktop for Windows (with the WSL 2 backend) from https://www.docker.com/products/docker-desktop, restart your computer if it asks, then run the script again."
}
try {
    docker info --format "{{.ServerVersion}}" | Out-Null
} catch {
    Write-Fail "Docker Desktop is installed but not running. Start Docker Desktop (wait until its tray icon says it is running), then run the script again."
}
Write-Ok "Docker Desktop is running"

# --- 2. Environment file ------------------------------------------------------
Write-Step "Setting up .env"
if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) { Write-Fail ".env.example is missing from the repo. Re-download the project and try again." }
    Copy-Item ".env.example" ".env"
    Write-Ok "Created .env from .env.example (development defaults — change the secrets before any shared use)"
} else {
    Write-Ok ".env already exists — leaving it untouched"
}

# Field encryption (AES-256-GCM) for employee national IDs / IBANs needs a
# 64-hex-char ENCRYPTION_KEY. If .env has none, generate one now and store
# it in .env — the SAME key must be used every time the app runs, or
# previously encrypted values become unreadable (see docs/handover.md).
$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch '(?m)^ENCRYPTION_KEY="[0-9a-fA-F]{64}"') {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $key = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    if ($envContent -match '(?m)^ENCRYPTION_KEY=.*$') {
        $envContent = $envContent -replace '(?m)^ENCRYPTION_KEY=.*$', "ENCRYPTION_KEY=`"$key`""
    } else {
        $envContent = $envContent.TrimEnd() + "`r`nENCRYPTION_KEY=`"$key`"`r`n"
    }
    Set-Content ".env" $envContent -NoNewline
    Write-Ok "Generated ENCRYPTION_KEY and stored it in .env (keep this file — losing the key makes encrypted employee fields unreadable)"
} else {
    Write-Ok "ENCRYPTION_KEY already set in .env"
}

# --- 3. Services ---------------------------------------------------------------
Write-Step "Starting Postgres, Redis, MinIO and MailHog (docker compose up -d)"
try {
    docker compose up -d
} catch {
    Write-Fail "docker compose failed. Common causes: Docker Desktop is not running, or ports 5432 / 6379 / 9000 / 1025 are already in use by another program. Stop the other program (or change the ports in docker-compose.yml) and run the script again."
}
Write-Ok "Services started"

# Wait for Postgres to accept connections (up to 60 seconds).
Write-Step "Waiting for Postgres to be ready"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        docker compose exec -T postgres pg_isready -U eserp | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) { Write-Fail "Postgres did not become ready within 60 seconds. Run 'docker compose logs postgres' to see why, or restart Docker Desktop and try again." }
Write-Ok "Postgres is ready"

# --- 4. Dependencies -----------------------------------------------------------
Write-Step "Installing dependencies (pnpm install)"
try {
    pnpm install
} catch {
    Write-Fail "pnpm install failed. Try deleting the node_modules folder and running the script again. If the error mentions the lockfile, run 'pnpm install --no-frozen-lockfile' once."
}
Write-Ok "Dependencies installed"

# --- 5. Migrations + seed (owner URL — the app itself runs as eserp_app) -------
Write-Step "Running database migrations"
$env:DATABASE_URL = "postgresql://eserp:eserp_dev_password@localhost:5432/eserp?schema=public"
try {
    pnpm db:migrate
} catch {
    Write-Fail "Migrations failed. Check that Postgres is up ('docker compose ps') and that no other copy of the setup is running at the same time."
}
Write-Ok "Migrations applied"

Write-Step "Seeding the demo tenant (Al-Safa Trading)"
try {
    pnpm db:seed
} catch {
    Write-Fail "Seed failed. The database may already be seeded — if so, this step can be skipped and you can run 'pnpm dev' directly. Otherwise check the error above."
}
Write-Ok "Demo tenant seeded"

# --- 6. Done -------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  EsERP is ready!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the apps with:  pnpm dev"
Write-Host ""
Write-Host "  Web app:  http://localhost:3000"
Write-Host "  API:      http://localhost:3001/api/v1/health"
Write-Host ""
Write-Host "  Demo login:"
Write-Host "    Email:    admin@alsafa-trading.sa"
Write-Host "    Password: Demo1234!"
Write-Host ""
Write-Host "  See README.md (\"Run on Windows\") for the manual steps and"
Write-Host "  troubleshooting if anything above did not work."
