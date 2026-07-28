# Stage 4 (Railway-to-PC migration) -- automated backup of the local
# production Postgres (foundry_postgres_prod, port 5433). Reads the DB
# password from .env.local-prod (gitignored) rather than hardcoding it,
# so this script is safe to commit.
#
# Registered via Windows Task Scheduler to run on an interval; writes
# output off-machine (OneDrive-synced folder), never onto the same disk
# as the live database alone.

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot ".env.local-prod"
$BackupDir = "C:\Users\shaur\OneDrive - h3ros\backups\found3ry"
$RetentionDays = 30

if (-not (Test-Path $EnvFile)) {
    Write-Error "Missing $EnvFile -- cannot read POSTGRES_PASSWORD_LOCAL_PROD"
    exit 1
}

$envVars = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([^=#]+)=(.*)$') {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}
$pgPassword = $envVars["POSTGRES_PASSWORD_LOCAL_PROD"]
if (-not $pgPassword) {
    Write-Error "POSTGRES_PASSWORD_LOCAL_PROD not found in $EnvFile"
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMddTHHmmss"
$outFile = "found3ry_local_prod_$timestamp.sql"
$dbUrl = "postgresql://foundry:$pgPassword@host.docker.internal:5433/foundry_db"

Write-Host "Backing up foundry_postgres_prod -> $BackupDir\$outFile"

docker run --rm `
    -v "${BackupDir}:/backup" `
    -e PGURL="$dbUrl" `
    postgres:18 `
    bash -c "pg_dump `"`$PGURL`" --no-owner --no-privileges -f /backup/$outFile"

if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    exit 1
}

$fileInfo = Get-Item (Join-Path $BackupDir $outFile) -ErrorAction SilentlyContinue
if (-not $fileInfo -or $fileInfo.Length -eq 0) {
    Write-Error "Backup file missing or empty: $outFile"
    exit 1
}

Write-Host "Backup succeeded: $($fileInfo.Length) bytes -> $($fileInfo.FullName)"

# Retention: delete backups older than $RetentionDays, keep at least the
# most recent 3 regardless of age (never let a bad run empty the folder).
$allBackups = Get-ChildItem $BackupDir -Filter "found3ry_local_prod_*.sql" | Sort-Object LastWriteTime -Descending
$toKeep = $allBackups | Select-Object -First 3
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$allBackups | Where-Object { $_.LastWriteTime -lt $cutoff -and $toKeep -notcontains $_ } | ForEach-Object {
    Write-Host "Pruning old backup: $($_.Name)"
    Remove-Item $_.FullName -Force
}

exit 0
