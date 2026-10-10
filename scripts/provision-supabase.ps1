param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskConfig = [IO.File]::ReadAllText((Join-Path $taskRoot 'supabase-config.js'), [Text.Encoding]::UTF8)
$taskUrl = [regex]::Match($taskConfig, "url:\s*'([^']+)'").Groups[1].Value.TrimEnd('/')
if ($taskUrl -notmatch '^https://[a-z0-9]+\.supabase\.co$') {
    throw 'Set the real Supabase Project URL in supabase-config.js first. A GitHub Pages URL cannot be used.'
}
$taskHtml = [IO.File]::ReadAllText((Join-Path $taskRoot 'index.html'), [Text.Encoding]::UTF8)
$taskDistrictArray = [regex]::Match($taskHtml, 'const districts=\[([^\]]+)\]').Groups[1].Value
$taskDistricts = @([regex]::Matches($taskDistrictArray, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
if ($taskDistricts.Count -ne 22) { throw 'Expected exactly 22 districts. Nothing was changed.' }
Write-Host ('Target Supabase project: ' + $taskUrl)
Write-Host 'Creates missing district accounts and assigns collector/district profiles. Existing passwords are preserved.'
Write-Host 'Creates a provincial admin account if absent. Enter the server secret key locally; it will not be saved.'
$taskSecureKey = Read-Host 'Supabase secret key or legacy service_role key' -AsSecureString
$taskSecret = [Net.NetworkCredential]::new('', $taskSecureKey).Password.Trim()
$taskHeaders = @{ apikey = $taskSecret }
if ($taskSecret -notlike 'sb_secret_*') { $taskHeaders.Authorization = 'Bearer ' + $taskSecret }
function Invoke-ProjectApi {
    param([string]$Path, [string]$Method = 'Get', $Body = $null, [hashtable]$ExtraHeaders = @{})
    $taskRequestHeaders = @{} + $taskHeaders + $ExtraHeaders
    # Windows PowerShell's default User-Agent starts with Mozilla, which Supabase
    # classifies as a browser. Identify this private local administration script.
    $taskRequest = @{Uri = $taskUrl + $Path; Method = $Method; Headers = $taskRequestHeaders; TimeoutSec = 30; UserAgent = 'GRDUSSKO-Provisioning/1.0 (PowerShell; local-admin)'}
    if ($null -ne $Body) {
        $taskRequest.ContentType = 'application/json; charset=utf-8'
        $taskRequest.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress))
    }
    Invoke-RestMethod @taskRequest
}
try {
    $taskUsers = @()
    $taskPage = 1
    do {
        $taskList = Invoke-ProjectApi -Path ('/auth/v1/admin/users?page=' + $taskPage + '&per_page=100')
        $taskUsers += @($taskList.users)
        $taskPage++
    } while (@($taskList.users).Count -eq 100)
    $taskAccounts = @()
    for ($taskIndex = 0; $taskIndex -lt 22; $taskIndex++) {
        $taskDistrict = $taskDistricts[$taskIndex]
        $taskAccounts += @{email = ('district-{0:D2}@grdussko.local' -f ($taskIndex + 1)); password = $taskDistrict; role = 'collector'; district = $taskDistrict; full_name = $taskDistrict}
    }
    # Thai alias for admin, identical to the login alias in index.html.
    $taskAdminName = -join @([char]0x0E41,[char]0x0E2D,[char]0x0E14,[char]0x0E21,[char]0x0E34,[char]0x0E19)
    $taskAccounts += @{email = 'admin@grdussko.local'; password = $taskAdminName; role = 'provincial_admin'; district = $null; full_name = $taskAdminName}
    $taskCompleted = 0
    foreach ($taskAccount in $taskAccounts) {
        $taskUser = $taskUsers | Where-Object { $_.email -eq $taskAccount.email } | Select-Object -First 1
        if (-not $taskUser) {
            $taskCreated = Invoke-ProjectApi -Path '/auth/v1/admin/users' -Method 'Post' -Body @{
                email = $taskAccount.email; password = $taskAccount.password; email_confirm = $true
                user_metadata = @{full_name = $taskAccount.full_name}
            }
            $taskUser = if ($taskCreated.user) { $taskCreated.user } else { $taskCreated }
        }
        if (-not $taskUser.id) { throw ('Missing Auth user id for ' + $taskAccount.email) }
        $taskProfile = @{id = $taskUser.id; email = $taskAccount.email; full_name = $taskAccount.full_name; role = $taskAccount.role; district = $taskAccount.district}
        $taskResult = @(Invoke-ProjectApi -Path '/rest/v1/profiles?on_conflict=id' -Method 'Post' -ExtraHeaders @{Prefer='resolution=merge-duplicates,return=representation'} -Body @($taskProfile))
        if ($taskResult.Count -ne 1 -or $taskResult[0].role -ne $taskAccount.role -or $taskResult[0].district -ne $taskAccount.district) {
            throw ('Profile verification failed for ' + $taskAccount.email)
        }
        $taskCompleted++
        Write-Host ('Ready ' + $taskCompleted + '/23: ' + $taskAccount.email + ' (' + $taskAccount.role + ')')
    }
    Write-Host 'All 22 district accounts and provincial admin profiles verified.'
} finally {
    $taskHeaders.Clear()
    $taskSecret = $null
    $taskSecureKey.Dispose()
}
