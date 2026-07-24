param(
    [string]$Station = 'TBS'
)

$ErrorActionPreference = 'Stop'

$AUTH1_URL = 'https://radiko.jp/v2/api/auth1'
$AUTH2_URL = 'https://radiko.jp/v2/api/auth2'
$AUTH_KEY  = 'bcd151073c03b352e1ef2fd66c32209da9ca0afa'
$STATION_STREAM_XML_URL = 'https://radiko.jp/v3/station/stream/pc_html5/{0}.xml'

# --- auth1 ---
$auth1Headers = @{
    'X-Radiko-App'         = 'pc_html5'
    'X-Radiko-App-Version' = '0.0.1'
    'X-Radiko-User'        = 'dummy_user'
    'X-Radiko-Device'      = 'pc'
}
$res1 = Invoke-WebRequest -Uri $AUTH1_URL -Headers $auth1Headers -Method Get -UseBasicParsing
$token  = $res1.Headers['X-Radiko-AuthToken']
$offset = [int]$res1.Headers['X-Radiko-KeyOffset']
$length = [int]$res1.Headers['X-Radiko-KeyLength']
Write-Host "token: $token"

# --- partial key & auth2 ---
$partialKeyAscii = $AUTH_KEY.Substring($offset, $length)
$partialKey = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($partialKeyAscii))
$auth2Headers = @{
    'X-Radiko-AuthToken'  = $token
    'X-Radiko-Partialkey' = $partialKey
    'X-Radiko-User'       = 'dummy_user'
    'X-Radiko-Device'     = 'pc'
}
$res2 = Invoke-WebRequest -Uri $AUTH2_URL -Headers $auth2Headers -Method Get -UseBasicParsing
Write-Host "auth2: $($res2.StatusCode) $($res2.Content)"

$commonHeaders = @{
    'X-Radiko-AuthToken'    = $token
    'X-Radiko-App'          = 'pc_html5'
    'X-Radiko-App-Version'  = '0.0.1'
    'X-Radiko-User'         = 'dummy_user'
    'X-Radiko-Device'       = 'pc'
}

# --- station stream xml -> playlist_create_url ---
[xml]$xml = (Invoke-WebRequest -Uri ($STATION_STREAM_XML_URL -f $Station) -UseBasicParsing).Content
$liveUrls = $xml.urls.url | Where-Object { $_.timefree -eq '0' }
$chosen = ($liveUrls | Where-Object { $_.areafree -eq '0' } | Select-Object -First 1)
if (-not $chosen) { $chosen = $liveUrls | Select-Object -First 1 }
$createUrl = $chosen.playlist_create_url
Write-Host "playlist_create_url: $createUrl"

# --- master playlist -> medialist url ---
$lsidBytes = New-Object byte[] 16
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($lsidBytes)
$lsid = ($lsidBytes | ForEach-Object { $_.ToString('x2') }) -join ''
$masterUrl = "$createUrl`?station_id=$Station&l=15&lsid=$lsid&type=c"
Write-Host "master playlist url: $masterUrl"

$masterRes = Invoke-WebRequest -Uri $masterUrl -Headers $commonHeaders -UseBasicParsing
Write-Host "master status: $($masterRes.StatusCode)"
$masterText = [System.Text.Encoding]::UTF8.GetString($masterRes.Content)
$mediaLine = ($masterText -split "`n" | Where-Object { $_ -match '^https?://' -and $_ -notmatch '^#' } | Select-Object -First 1).Trim()
Write-Host "medialist url: $mediaLine"

# --- compare clients against the SAME medialist url ---
Write-Host "`n--- Invoke-WebRequest (like got) ---"
try {
    $viaIwr = Invoke-WebRequest -Uri $mediaLine -Headers $commonHeaders -UseBasicParsing
    $viaIwrText = [System.Text.Encoding]::UTF8.GetString($viaIwr.Content)
    Write-Host "status: $($viaIwr.StatusCode)  content-type: $($viaIwr.Headers['Content-Type'])  len: $($viaIwrText.Length)"
    Write-Host "body head: $($viaIwrText.Substring(0, [Math]::Min(200, $viaIwrText.Length)))"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

Write-Host "`n--- curl.exe (default User-Agent: curl/x.x) ---"
$headerArgs = @(
    '-H', "X-Radiko-AuthToken: $token"
    '-H', 'X-Radiko-App: pc_html5'
    '-H', 'X-Radiko-App-Version: 0.0.1'
    '-H', 'X-Radiko-User: dummy_user'
    '-H', 'X-Radiko-Device: pc'
)
& curl.exe -s -D - -o "$PSScriptRoot\curl-default-ua.m3u8" @headerArgs $mediaLine
Write-Host "saved body:"
Get-Content "$PSScriptRoot\curl-default-ua.m3u8" -ErrorAction SilentlyContinue

Write-Host "`n--- curl.exe (User-Agent: Lavf/59.27.100, ffmpeg mimic) ---"
& curl.exe -s -D - -o "$PSScriptRoot\curl-lavf-ua.m3u8" -A 'Lavf/59.27.100' @headerArgs $mediaLine
Write-Host "saved body:"
Get-Content "$PSScriptRoot\curl-lavf-ua.m3u8" -ErrorAction SilentlyContinue
