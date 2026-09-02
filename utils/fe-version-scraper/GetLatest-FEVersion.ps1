# GetLatest-FEVersion.ps1 (GHA output directly)

try {
    Write-Host "🔎 Fetching latest version of Fiddler Everywhere..."
    $url = "https://www.telerik.com/support/whats-new/fiddler-everywhere/release-history"

    $htmlContent = Invoke-RestMethod -Uri $url -Method Get

    # Match both "v8.1.0" and the older page format "v.8.0.2".
    $pattern = 'Fiddler Everywhere v\.?\s*(\d+\.\d+\.\d+)'
    $matches = [regex]::Matches([string]$htmlContent, $pattern)

    if ($matches.Count -eq 0) {
        throw "Could not find the version pattern in the page's HTML."
    }

    # Do not rely on the order of the release-history page. Select the highest
    # semantic version from all entries returned by the page.
    $versions = @(
        foreach ($match in $matches) {
            $match.Groups[1].Value
        }
    ) | Sort-Object -Unique

    $latestVersion = $versions |
        ForEach-Object { [version]$_ } |
        Sort-Object -Descending |
        Select-Object -First 1
    $version = $latestVersion.ToString(3)
    Write-Host "✅ Latest Version Found: $version"
    Write-Host "📦 Versions detected: $($versions -join ', ')"

    if ($env:GITHUB_OUTPUT) {
        Write-Host "🚀 Setting GitHub Actions output variable..."
        "scraped_version=$version" | Out-File -Append -FilePath $env:GITHUB_OUTPUT
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
