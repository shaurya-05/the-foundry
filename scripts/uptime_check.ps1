# Task 3 (post-migration gap closure) -- self-hosted uptime monitor for
# api.found3ry.com, since Railway no longer covers for outages and no
# working email pipe exists (RESEND_API_KEY is unset everywhere -- see
# backend/app/services/email.py, which silently falls back to console
# logging). Alerts via ntfy.sh (no account required, just a topic name)
# instead of a UptimeRobot/Better Stack signup, which Claude can't do on
# the user's behalf.
#
# State-file based so it alerts on TRANSITION (up->down, down->up), not
# on every single failed check while already known-down -- avoids
# spamming a notification every 2 minutes during a real outage.

$Endpoint = "https://api.found3ry.com/api/health"
$TopicFile = Join-Path $PSScriptRoot ".ntfy_topic"
$StateFile = Join-Path $PSScriptRoot ".uptime_state"
$Topic = (Get-Content $TopicFile -Raw).Trim()
$NtfyUrl = "https://ntfy.sh/$Topic"

$prevState = "unknown"
if (Test-Path $StateFile) {
    $prevState = (Get-Content $StateFile -Raw).Trim()
}

$isUp = $false
$detail = ""
try {
    $resp = Invoke-WebRequest -Uri $Endpoint -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
        $isUp = $true
    } else {
        $detail = "HTTP $($resp.StatusCode)"
    }
} catch {
    $detail = $_.Exception.Message
}

$currState = if ($isUp) { "up" } else { "down" }
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if ($currState -ne $prevState) {
    if ($currState -eq "down") {
        $title = "FOUND3RY API DOWN"
        $message = "api.found3ry.com failed health check at $timestamp. $detail"
        $priority = "urgent"
        $tags = "rotating_light"
    } else {
        $title = "FOUND3RY API RECOVERED"
        $message = "api.found3ry.com is back up as of $timestamp."
        $priority = "default"
        $tags = "white_check_mark"
    }
    try {
        Invoke-RestMethod -Uri $NtfyUrl -Method Post -Body $message `
            -Headers @{ "Title" = $title; "Priority" = $priority; "Tags" = $tags } `
            -TimeoutSec 10 | Out-Null
        Write-Host "[$timestamp] State changed: $prevState -> $currState. Alert sent to $NtfyUrl"
    } catch {
        Write-Host "[$timestamp] State changed: $prevState -> $currState. ALERT SEND FAILED: $($_.Exception.Message)"
    }
} else {
    Write-Host "[$timestamp] State unchanged: $currState"
}

Set-Content -Path $StateFile -Value $currState -NoNewline
