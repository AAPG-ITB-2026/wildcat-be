param(
    [string]$BaseUrl = "http://127.0.0.1:8787",
    [string]$TeamToken = $env:E2E_TEAM_TOKEN,
    [string]$AdminToken = $env:E2E_ADMIN_TOKEN,
    [switch]$RequireAuthTests,
    [switch]$VerboseResponse
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Api {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PUT', 'PATCH', 'DELETE')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Headers,
        [object]$Body
    )

    $uri = "{0}{1}" -f $BaseUrl.TrimEnd('/'), $Path
    $requestHeaders = @{}
    if ($Headers) {
        foreach ($k in $Headers.Keys) {
            $requestHeaders[$k] = $Headers[$k]
        }
    }

    $params = @{
        Uri                = $uri
        Method             = $Method
        Headers            = $requestHeaders
        SkipHttpErrorCheck = $true
    }

    if ($null -ne $Body) {
        $params['ContentType'] = 'application/json'
        $params['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
    }

    $resp = Invoke-WebRequest @params
    $parsed = $null

    if ($resp.Content) {
        try {
            $parsed = $resp.Content | ConvertFrom-Json -Depth 20
        }
        catch {
            $parsed = $null
        }
    }

    [PSCustomObject]@{
        Uri     = $uri
        Status  = [int]$resp.StatusCode
        RawBody = $resp.Content
        Json    = $parsed
    }
}

function Assert-Status {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][int[]]$Expected
    )

    if ($Response.Status -notin $Expected) {
        throw "Expected status [$($Expected -join ', ')], got $($Response.Status)."
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Add-Test {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Body
    )

    [PSCustomObject]@{
        Name = $Name
        Body = $Body
    }
}

function New-BearerHeader {
    param([Parameter(Mandatory = $true)][string]$Token)
    @{ Authorization = "Bearer $Token" }
}

$tests = New-Object System.Collections.Generic.List[object]

# Smoke tests (no tokens)
$tests.Add((Add-Test -Name 'GET /health returns status=ok' -Body {
    $r = Invoke-Api -Method GET -Path '/health'
    Assert-Status -Response $r -Expected @(200)
    Assert-True -Condition ($null -ne $r.Json) -Message 'Expected JSON body from /health'
    Assert-True -Condition ($r.Json.status -eq 'ok') -Message 'Expected /health status to be ok'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($r.Json.timestamp)) -Message 'Expected /health timestamp'
}))

$tests.Add((Add-Test -Name 'GET /api/landing/ without token returns 401' -Body {
    $r = Invoke-Api -Method GET -Path '/api/landing/'
    Assert-Status -Response $r -Expected @(401)
}))

$tests.Add((Add-Test -Name 'GET /api/announcements without token returns 401' -Body {
    $r = Invoke-Api -Method GET -Path '/api/announcements'
    Assert-Status -Response $r -Expected @(401)
}))

$tests.Add((Add-Test -Name 'PATCH /api/admin/config without token returns 401' -Body {
    $r = Invoke-Api -Method PATCH -Path '/api/admin/config' -Body @{ key = 'RELEASE_SCORES'; value = 'true' }
    Assert-Status -Response $r -Expected @(401)
}))

if ($TeamToken) {
    $teamHeaders = New-BearerHeader -Token $TeamToken

    $tests.Add((Add-Test -Name 'GET /api/landing/?lang=en with team token returns EN payload' -Body {
        $r = Invoke-Api -Method GET -Path '/api/landing/?lang=en' -Headers $teamHeaders
        Assert-Status -Response $r -Expected @(200)
        Assert-True -Condition ($r.Json.meta.lang -eq 'EN') -Message 'Expected meta.lang to be EN'
        Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($r.Json.hero.title)) -Message 'Expected hero.title'
    }))

    $tests.Add((Add-Test -Name 'GET /api/landing/ with team token defaults to ID' -Body {
        $r = Invoke-Api -Method GET -Path '/api/landing/' -Headers $teamHeaders
        Assert-Status -Response $r -Expected @(200)
        Assert-True -Condition ($r.Json.meta.lang -eq 'ID') -Message 'Expected default meta.lang to be ID'
    }))

    $tests.Add((Add-Test -Name 'GET /api/announcements with team token is authorized' -Body {
        $r = Invoke-Api -Method GET -Path '/api/announcements' -Headers $teamHeaders
        Assert-Status -Response $r -Expected @(200, 404)

        if ($r.Status -eq 200) {
            Assert-True -Condition ($r.Json.success -eq $true) -Message 'Expected success=true for announcements 200 response'
        }

        if ($r.Status -eq 404) {
            Assert-True -Condition ($r.Json.error -eq 'Team profile not found') -Message 'Unexpected 404 response body for announcements'
        }
    }))
}

if ($AdminToken) {
    $adminHeaders = New-BearerHeader -Token $AdminToken

    $tests.Add((Add-Test -Name 'PATCH /api/admin/config with admin token succeeds' -Body {
        $r = Invoke-Api -Method PATCH -Path '/api/admin/config' -Headers $adminHeaders -Body @{ key = 'RELEASE_SCORES'; value = 'true' }
        Assert-Status -Response $r -Expected @(200)
        Assert-True -Condition ($r.Json.success -eq $true) -Message 'Expected success=true from admin config update'
    }))

    $tests.Add((Add-Test -Name 'PATCH /api/admin/config invalid body returns 400' -Body {
        $r = Invoke-Api -Method PATCH -Path '/api/admin/config' -Headers $adminHeaders -Body @{ key = 'INVALID_FLAG'; value = 'yep' }
        Assert-Status -Response $r -Expected @(400)
    }))

    $tests.Add((Add-Test -Name 'PUT /api/admin/content/homepage with admin token succeeds' -Body {
        $payload = @{ content = '{"headline":"Wildcat 2026"}' }
        $r = Invoke-Api -Method PUT -Path '/api/admin/content/homepage' -Headers $adminHeaders -Body $payload
        Assert-Status -Response $r -Expected @(200)
        Assert-True -Condition ($r.Json.success -eq $true) -Message 'Expected success=true from content update'
    }))

    $tests.Add((Add-Test -Name 'POST /api/admin/announcements with admin token creates record' -Body {
        $payload = @{
            title          = 'E2E Broadcast'
            content        = 'Automated backend test announcement'
            targetAudience = 'All'
        }
        $r = Invoke-Api -Method POST -Path '/api/admin/announcements' -Headers $adminHeaders -Body $payload
        Assert-Status -Response $r -Expected @(201)
        Assert-True -Condition ($r.Json.success -eq $true) -Message 'Expected success=true from announcement create'
        Assert-True -Condition ($null -ne $r.Json.announcement) -Message 'Expected announcement object in response'
    }))
}

if ($TeamToken -and $AdminToken) {
    $teamHeaders = New-BearerHeader -Token $TeamToken
    $tests.Add((Add-Test -Name 'PATCH /api/admin/config with non-admin token returns 403' -Body {
        $r = Invoke-Api -Method PATCH -Path '/api/admin/config' -Headers $teamHeaders -Body @{ key = 'MAINTENANCE_MODE'; value = 'false' }
        Assert-Status -Response $r -Expected @(403)
    }))
}

if ($RequireAuthTests) {
    if (-not $TeamToken) {
        throw 'RequireAuthTests was set, but E2E_TEAM_TOKEN (or -TeamToken) was not provided.'
    }
    if (-not $AdminToken) {
        throw 'RequireAuthTests was set, but E2E_ADMIN_TOKEN (or -AdminToken) was not provided.'
    }
}

$results = New-Object System.Collections.Generic.List[object]

Write-Host "Running $($tests.Count) backend E2E test(s) against $BaseUrl" -ForegroundColor Cyan

foreach ($test in $tests) {
    $start = Get-Date
    try {
        & $test.Body
        $duration = ((Get-Date) - $start).TotalMilliseconds
        $results.Add([PSCustomObject]@{
                Test       = $test.Name
                Result     = 'PASS'
                DurationMs = [math]::Round($duration, 1)
                Detail     = ''
            })
        Write-Host "[PASS] $($test.Name)" -ForegroundColor Green
    }
    catch {
        $duration = ((Get-Date) - $start).TotalMilliseconds
        $detail = $_.Exception.Message
        $results.Add([PSCustomObject]@{
                Test       = $test.Name
                Result     = 'FAIL'
                DurationMs = [math]::Round($duration, 1)
                Detail     = $detail
            })
        Write-Host "[FAIL] $($test.Name)" -ForegroundColor Red
        Write-Host "       $detail" -ForegroundColor DarkRed
    }
}

$passCount = @($results | Where-Object { $_.Result -eq 'PASS' }).Count
$failCount = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count

Write-Host ''
Write-Host '================ E2E Summary ================' -ForegroundColor Cyan
$results | Format-Table -AutoSize Test, Result, DurationMs

if ($VerboseResponse -and $failCount -gt 0) {
    Write-Host ''
    Write-Host 'Failure details:' -ForegroundColor Yellow
    $results | Where-Object { $_.Result -eq 'FAIL' } | ForEach-Object {
        Write-Host "- $($_.Test): $($_.Detail)" -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host "Passed: $passCount" -ForegroundColor Green
Write-Host "Failed: $failCount" -ForegroundColor Red

if ($failCount -gt 0) {
    exit 1
}

exit 0
