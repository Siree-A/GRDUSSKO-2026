$ErrorActionPreference = 'Stop'
$global:provisionTestApiCalls = @()
$global:provisionTestExistingUsers = @()
function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    ConvertTo-SecureString 'sb_secret_mock_not_a_real_key' -AsPlainText -Force
}
function Invoke-RestMethod {
    param($Uri, $Method, $Headers, $TimeoutSec, $UserAgent, $ContentType, $Body)
    if ($UserAgent -ne 'GRDUSSKO-Provisioning/1.0 (PowerShell; local-admin)') {
        throw 'Unexpected User-Agent; Windows PowerShell default must not be used.'
    }
    if ($Headers.apikey -ne 'sb_secret_mock_not_a_real_key') { throw 'Missing mock key' }
    if ($Headers.ContainsKey('Authorization')) { throw 'Secret key must not be used as a JWT' }
    $global:provisionTestApiCalls += @{uri = $Uri; method = $Method}
    if ($Uri -match '/auth/v1/admin/users\?') { return @{users = $global:provisionTestExistingUsers} }
    $taskMockBody = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    if ($Uri -match '/auth/v1/admin/users$') {
        if (-not $taskMockBody.email_confirm) { throw 'Email confirmation is required' }
        if (-not $taskMockBody.password) { throw 'Missing initial password' }
        return @{id = $taskMockBody.email; email = $taskMockBody.email}
    }
    if ($Uri -match '/rest/v1/profiles\?') { return $taskMockBody }
    throw 'Unexpected API endpoint'
}
$taskScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/provision-supabase.ps1'
& $taskScriptPath
if (@($global:provisionTestApiCalls | Where-Object { $_.uri -match '/auth/v1/admin/users$' }).Count -ne 23) { throw 'Expected 23 user creations' }
if (@($global:provisionTestApiCalls | Where-Object { $_.uri -match '/rest/v1/profiles\?' }).Count -ne 23) { throw 'Expected 23 profile verifications' }
$global:provisionTestExistingUsers = @(1..22 | ForEach-Object { @{id = ('existing-' + $_); email = ('district-{0:D2}@grdussko.local' -f $_)} })
$global:provisionTestExistingUsers += @{id = 'existing-admin'; email = 'admin@grdussko.local'}
$global:provisionTestApiCalls = @()
& $taskScriptPath
if (@($global:provisionTestApiCalls | Where-Object { $_.uri -match '/auth/v1/admin/users$' }).Count -ne 0) { throw 'Existing accounts must not be recreated' }
if (@($global:provisionTestApiCalls | Where-Object { $_.uri -match '/rest/v1/profiles\?' }).Count -ne 23) { throw 'Expected verification of existing profiles' }
Write-Output 'PASS: Windows PowerShell request identity, 23 new accounts, profile verification, safe rerun'
