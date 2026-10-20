<#
  Drama Studio release window (Windows PowerShell 5.1 or PowerShell 7).
  Started by "Release Drama Studio.bat" in the repository root.

  Asks before anything happens, then:
    1. bumps the version on a release/vX.Y.Z branch, in a temporary worktree
       made from origin/main (your own checkout is never touched),
    2. pushes the branch, opens a pull request, waits for the required checks
       and merges it (admin merge: main is protected and needs a pull request),
    3. tags the merge commit vX.Y.Z and pushes the tag, which starts
       .github/workflows/release.yml (Windows and Linux installers, a draft
       release),
    4. waits for the build, writes the release notes from CHANGELOG.md,
    5. asks again before publishing: a published release reaches every
       installed copy through auto-update and is announced on Discord.

  Needs git, node and the GitHub CLI (gh) signed in with access to the repo.
  -DryRun (or the Dry run box) does steps 1 and the checks locally and pushes
  nothing. -SelfTest runs a dry run without the window (answers yes, prints
  the log); it never pushes.
#>
param([switch]$DryRun, [switch]$SelfTest)
if ($SelfTest) { $DryRun = $true }

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Repo = 'jeffreycayao/Drama-Studio'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $env:TEMP 'drama-studio-release'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:Busy = $false
$script:Cancelled = $false

# --- Colours (Drama Studio: charcoal, cream, one lime accent) ---------------
$Charcoal = [System.Drawing.ColorTranslator]::FromHtml('#27231B')
$Panel = [System.Drawing.ColorTranslator]::FromHtml('#312C22')
$Cream = [System.Drawing.ColorTranslator]::FromHtml('#F6F1E6')
$Muted = [System.Drawing.ColorTranslator]::FromHtml('#CFC7B4')
$Lime = [System.Drawing.ColorTranslator]::FromHtml('#D5FA00')
$Olive = [System.Drawing.ColorTranslator]::FromHtml('#687323')

# --- Small helpers -----------------------------------------------------------

function Add-Log([string]$Text) {
  $stamp = (Get-Date).ToString('HH:mm:ss')
  foreach ($line in ($Text -split "`r?`n")) {
    if ($line -ne '') {
      $LogBox.AppendText("[$stamp] $line`r`n")
      if ($SelfTest) { Write-Host "[$stamp] $line" }
    }
  }
  [System.Windows.Forms.Application]::DoEvents()
}

function Set-Status([string]$Text) {
  $StatusLabel.Text = $Text
  Add-Log "== $Text"
}

function Ask([string]$Title, [string]$Text) {
  if ($SelfTest) { Add-Log "(self-test answers yes) $Title"; return $true }
  $answer = [System.Windows.Forms.MessageBox]::Show($Form, $Text, $Title,
    [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
  return $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

function Show-Error([string]$Text) {
  Add-Log "ERROR: $Text"
  if ($SelfTest) { $script:SelfTestFailed = $true; return }
  [System.Windows.Forms.MessageBox]::Show($Form, $Text, 'Release stopped',
    [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

# Runs a command line through cmd.exe, streams its output into the log while
# keeping the window responsive, and returns @{ Code; Output }.
function Invoke-Step([string]$CommandLine, [string]$WorkDir = $RepoRoot, [switch]$Quiet) {
  if (-not $Quiet) { Add-Log "> $CommandLine" }
  $logFile = Join-Path $LogDir ("step-{0}.log" -f ([guid]::NewGuid().ToString('N')))
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$CommandLine > `"$logFile`" 2>&1`"" `
    -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru
  $seen = 0
  $buffer = ''
  while ($true) {
    $exited = $process.HasExited
    if (Test-Path $logFile) {
      try {
        $stream = [System.IO.File]::Open($logFile, 'Open', 'Read', 'ReadWrite')
        $stream.Seek($seen, 'Begin') | Out-Null
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $chunk = $reader.ReadToEnd()
        $seen = $stream.Position
        $reader.Close()
        if ($chunk) {
          $buffer += $chunk
          if (-not $Quiet) { Add-Log $chunk.TrimEnd() }
        }
      } catch { }
    }
    if ($exited) { break }
    if ($script:Cancelled) { try { $process.Kill() } catch { } ; break }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 150
  }
  $process.WaitForExit()
  Remove-Item $logFile -ErrorAction SilentlyContinue
  return @{ Code = $process.ExitCode; Output = $buffer.Trim() }
}

# Windows PowerShell 5.1 reads BOM-less files as ANSI; CHANGELOG.md and the
# notes contain non-ASCII text, so read and write UTF-8 explicitly.
function Read-Utf8([string]$Path) { return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) }
function Write-Utf8([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false))) }

function Require([hashtable]$Result, [string]$What) {
  if ($Result.Code -ne 0) { throw "$What failed (exit code $($Result.Code))." }
  return $Result.Output
}

function Next-Version([string]$Current, [string]$Kind) {
  $parts = $Current.Split('.') | ForEach-Object { [int]$_ }
  switch ($Kind) {
    'major' { return '{0}.0.0' -f ($parts[0] + 1) }
    'minor' { return '{0}.{1}.0' -f $parts[0], ($parts[1] + 1) }
    default { return '{0}.{1}.{2}' -f $parts[0], $parts[1], ($parts[2] + 1) }
  }
}

# Text under "## [Unreleased]" (or "## [x.y.z]") in a CHANGELOG.
function Get-ChangelogSection([string]$Changelog, [string]$Heading) {
  $lines = $Changelog -split "`r?`n"
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ('^## \[' + [regex]::Escape($Heading) + '\]')) { $start = $i + 1; break }
  }
  if ($start -lt 0) { return '' }
  $out = New-Object System.Collections.Generic.List[string]
  for ($i = $start; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^## \[') { break }
    $out.Add($lines[$i])
  }
  return ($out -join "`r`n").Trim()
}

# --- Window ------------------------------------------------------------------

$Form = New-Object System.Windows.Forms.Form
$Form.Text = 'Drama Studio - Build and release'
$Form.Size = New-Object System.Drawing.Size(860, 760)
$Form.MinimumSize = New-Object System.Drawing.Size(760, 640)
$Form.StartPosition = 'CenterScreen'
$Form.BackColor = $Charcoal
$Form.ForeColor = $Cream
$Form.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)

$Title = New-Object System.Windows.Forms.Label
$Title.Text = 'Build and release Drama Studio'
$Title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 15)
$Title.AutoSize = $true
$Title.Location = New-Object System.Drawing.Point(18, 14)
$Form.Controls.Add($Title)

$InfoLabel = New-Object System.Windows.Forms.Label
$InfoLabel.Text = 'Reading the repository...'
$InfoLabel.ForeColor = $Muted
$InfoLabel.Location = New-Object System.Drawing.Point(20, 50)
$InfoLabel.Size = New-Object System.Drawing.Size(800, 40)
$InfoLabel.Anchor = 'Top,Left,Right'
$Form.Controls.Add($InfoLabel)

$KindBox = New-Object System.Windows.Forms.GroupBox
$KindBox.Text = 'Next version'
$KindBox.ForeColor = $Cream
$KindBox.Location = New-Object System.Drawing.Point(20, 92)
$KindBox.Size = New-Object System.Drawing.Size(800, 56)
$KindBox.Anchor = 'Top,Left,Right'
$Form.Controls.Add($KindBox)
$Radios = @{}
$x = 14
foreach ($kind in 'patch', 'minor', 'major') {
  $radio = New-Object System.Windows.Forms.RadioButton
  $radio.Tag = $kind
  $radio.AutoSize = $true
  $radio.Location = New-Object System.Drawing.Point($x, 22)
  $radio.ForeColor = $Cream
  $KindBox.Controls.Add($radio)
  $Radios[$kind] = $radio
  $x += 250
}
$Radios['patch'].Checked = $true

$NotesLabel = New-Object System.Windows.Forms.Label
$NotesLabel.Text = 'What is in this release (CHANGELOG.md, Unreleased on main):'
$NotesLabel.AutoSize = $true
$NotesLabel.Location = New-Object System.Drawing.Point(20, 158)
$Form.Controls.Add($NotesLabel)

$NotesBox = New-Object System.Windows.Forms.TextBox
$NotesBox.Multiline = $true
$NotesBox.ReadOnly = $true
$NotesBox.ScrollBars = 'Vertical'
$NotesBox.BackColor = $Panel
$NotesBox.ForeColor = $Cream
$NotesBox.BorderStyle = 'FixedSingle'
$NotesBox.Location = New-Object System.Drawing.Point(20, 180)
$NotesBox.Size = New-Object System.Drawing.Size(800, 150)
$NotesBox.Anchor = 'Top,Left,Right'
$Form.Controls.Add($NotesBox)

$WarnLabel = New-Object System.Windows.Forms.Label
$WarnLabel.ForeColor = $Muted
$WarnLabel.Location = New-Object System.Drawing.Point(20, 336)
$WarnLabel.Size = New-Object System.Drawing.Size(800, 54)
$WarnLabel.Anchor = 'Top,Left,Right'
$Form.Controls.Add($WarnLabel)

$DryRunBox = New-Object System.Windows.Forms.CheckBox
$DryRunBox.Text = 'Dry run: do the version bump and checks locally, push nothing'
$DryRunBox.AutoSize = $true
$DryRunBox.ForeColor = $Muted
$DryRunBox.Checked = [bool]$DryRun
$DryRunBox.Location = New-Object System.Drawing.Point(20, 394)
$Form.Controls.Add($DryRunBox)

$GoButton = New-Object System.Windows.Forms.Button
$GoButton.Text = 'Build and release'
$GoButton.BackColor = $Lime
$GoButton.ForeColor = $Charcoal
$GoButton.FlatStyle = 'Flat'
$GoButton.FlatAppearance.BorderSize = 0
$GoButton.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$GoButton.Size = New-Object System.Drawing.Size(230, 36)
$GoButton.Location = New-Object System.Drawing.Point(590, 388)
$GoButton.Anchor = 'Top,Right'
$GoButton.Enabled = $false
$Form.Controls.Add($GoButton)

$CloseButton = New-Object System.Windows.Forms.Button
$CloseButton.Text = 'Close'
$CloseButton.BackColor = $Panel
$CloseButton.ForeColor = $Cream
$CloseButton.FlatStyle = 'Flat'
$CloseButton.Size = New-Object System.Drawing.Size(100, 36)
$CloseButton.Location = New-Object System.Drawing.Point(482, 388)
$CloseButton.Anchor = 'Top,Right'
$Form.Controls.Add($CloseButton)

$StatusLabel = New-Object System.Windows.Forms.Label
$StatusLabel.Text = ''
$StatusLabel.ForeColor = $Lime
$StatusLabel.Location = New-Object System.Drawing.Point(20, 432)
$StatusLabel.Size = New-Object System.Drawing.Size(800, 20)
$StatusLabel.Anchor = 'Top,Left,Right'
$Form.Controls.Add($StatusLabel)

$LogBox = New-Object System.Windows.Forms.TextBox
$LogBox.Multiline = $true
$LogBox.ReadOnly = $true
$LogBox.ScrollBars = 'Both'
$LogBox.WordWrap = $false
$LogBox.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#1E1B15')
$LogBox.ForeColor = $Muted
$LogBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$LogBox.BorderStyle = 'FixedSingle'
$LogBox.Location = New-Object System.Drawing.Point(20, 456)
$LogBox.Size = New-Object System.Drawing.Size(800, 240)
$LogBox.Anchor = 'Top,Bottom,Left,Right'
$Form.Controls.Add($LogBox)

# --- Reading the current state ---------------------------------------------

$script:Current = $null
$script:Unreleased = ''

function Update-Plan {
  if (-not $script:Current) { return }
  foreach ($kind in 'patch', 'minor', 'major') {
    $Radios[$kind].Text = '{0}  ->  v{1}' -f ($kind.Substring(0, 1).ToUpper() + $kind.Substring(1)), (Next-Version $script:Current $kind)
  }
  $GoButton.Text = 'Build and release v' + (Next-Version $script:Current (Get-Kind))
}

function Get-Kind {
  foreach ($kind in 'patch', 'minor', 'major') { if ($Radios[$kind].Checked) { return $kind } }
  return 'patch'
}

function Load-State {
  Set-Status 'Checking tools and the repository...'
  foreach ($tool in 'git', 'node', 'gh') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Show-Error "$tool is not installed or not on PATH."; return }
  }
  $auth = Invoke-Step 'gh auth status' -Quiet
  if ($auth.Code -ne 0) { Show-Error "The GitHub CLI is not signed in. Run 'gh auth login' first."; return }
  Require (Invoke-Step 'git fetch --quiet origin main --tags') 'git fetch' | Out-Null
  $pkg = Require (Invoke-Step 'git show origin/main:package.json' -Quiet) 'Reading package.json'
  $script:Current = ($pkg | ConvertFrom-Json).version
  $changelog = Require (Invoke-Step 'git show origin/main:CHANGELOG.md' -Quiet) 'Reading CHANGELOG.md'
  $script:Unreleased = Get-ChangelogSection $changelog 'Unreleased'
  if ($script:Unreleased) { $NotesBox.Text = $script:Unreleased } else { $NotesBox.Text = '(No notes under ## [Unreleased]. Add what changed before releasing.)' }

  $latest = Invoke-Step "gh release list -R $Repo --limit 1 --exclude-drafts --json tagName --jq .[0].tagName" -Quiet
  $prs = Invoke-Step "gh pr list -R $Repo --state open --json number,title --jq `".[] | \`"#\(.number) \(.title)\`"`"" -Quiet
  $InfoLabel.Text = "main is at v$($script:Current). Latest published release: $(if ($latest.Output) { $latest.Output } else { 'none' }).`r`nRepository: $Repo"
  $warn = @()
  if ($prs.Code -eq 0 -and $prs.Output) {
    $warn += 'Open pull requests (NOT in this release unless merged first): ' + (($prs.Output -split "`r?`n") -join '; ')
  }
  if (-not $script:Unreleased) { $warn += 'CHANGELOG.md has no Unreleased notes.' }
  $WarnLabel.Text = ($warn -join "`r`n")
  Update-Plan
  $GoButton.Enabled = $true
  Set-Status 'Ready. Nothing happens until you click the button and confirm.'
}

# --- The release ---------------------------------------------------------------

function Start-Release {
  $kind = Get-Kind
  $version = Next-Version $script:Current $kind
  $tag = "v$version"
  $branch = "release/$tag"
  $dry = $DryRunBox.Checked

  $tagCheck = Invoke-Step "git ls-remote --tags origin refs/tags/$tag" -Quiet
  if ($tagCheck.Output) { Show-Error "$tag already exists on GitHub. Pick another version."; return }

  $question = "Build and release Drama Studio $tag?`r`n`r`n" +
    "This will:`r`n" +
    "  1. bump the version from $($script:Current) to $version on branch $branch`r`n" +
    "  2. open a pull request, wait for its checks and merge it into main`r`n" +
    "  3. tag $tag so GitHub builds the Windows and Linux installers (a draft)`r`n" +
    "  4. ask you again before publishing`r`n`r`n" +
    "Nothing reaches users until you publish."
  if ($dry) { $question = "DRY RUN for $tag`r`n`r`nThe version bump and checks run locally in a temporary folder. Nothing is pushed. Continue?" }
  if (-not (Ask "Release $tag" $question)) { Add-Log 'Cancelled. Nothing was changed.'; return }

  $script:Busy = $true
  $GoButton.Enabled = $false
  $KindBox.Enabled = $false
  $DryRunBox.Enabled = $false
  $work = Join-Path $LogDir ("work-$version-" + (Get-Date).ToString('HHmmss'))
  try {
    Set-Status "1/5  Preparing $branch from origin/main"
    Require (Invoke-Step "git worktree add --quiet -b $branch `"$work`" origin/main") 'Creating the release worktree' | Out-Null
    Require (Invoke-Step "node scripts/bump-version.cjs $kind" $work) 'Version bump' | Out-Null
    Require (Invoke-Step 'node scripts/check-version-sync.cjs' $work) 'Version check' | Out-Null
    $bumped = (Read-Utf8 (Join-Path $work 'package.json') | ConvertFrom-Json).version
    if ($bumped -ne $version) { throw "package.json says $bumped, expected $version." }
    $notes = Get-ChangelogSection (Read-Utf8 (Join-Path $work 'CHANGELOG.md')) $version
    # An empty section means nothing was added under [Unreleased] since the last release.
    if (-not $notes) { throw "CHANGELOG.md has no notes for $version. Add them under ## [Unreleased] first; nothing was pushed." }
    Require (Invoke-Step 'git add -A' $work) 'git add' | Out-Null
    Require (Invoke-Step "git commit -q -m `"Drama Studio $tag release`"" $work) 'git commit' | Out-Null
    Add-Log ((Invoke-Step 'git show --stat --oneline HEAD' $work -Quiet).Output)

    if ($dry) {
      Set-Status "Dry run finished: $tag was prepared locally and nothing was pushed."
      Add-Log "Release notes that would be used:`r`n$notes"
      return
    }

    Set-Status "2/5  Pushing $branch and opening the pull request"
    Require (Invoke-Step "git push -q -u origin $branch" $work) 'git push' | Out-Null
    $body = @"
## Summary

Drama Studio $tag release commit: version bump (app and Companion), CHANGELOG $version, README version badges. Made by Release Drama Studio.bat.

## How it was tested

- [x] I ran the tests for the areas I changed (list them below)
- [x] I added a note under ``## [Unreleased]`` in ``CHANGELOG.md`` if users will notice the change

Tests run: ``check-version-sync``. The release workflow builds and verifies the installers from the tag.

## AI assistance

- [x] No AI tools wrote or changed code, tests or docs in this pull request.
- [ ] AI tools helped. Tool(s) used and which parts they wrote:

## Contribution rights

- [x] I have the right to submit this work under the project's license (GPL-3.0-only). It contains no code copied from closed-source products, other extensions or sites, and any third-party code keeps its license notice.
"@
    $bodyFile = Join-Path $LogDir "pr-$version.md"
    Write-Utf8 $bodyFile $body
    $prUrl = Require (Invoke-Step "gh pr create -R $Repo --base main --head $branch --title `"Drama Studio $tag release`" --body-file `"$bodyFile`"" $work) 'Opening the pull request'
    $prNumber = ($prUrl -split '/')[-1].Trim()
    Add-Log "Pull request: $prUrl"

    Set-Status "3/5  Waiting for the pull request's required checks"
    $passed = $false
    for ($attempt = 0; $attempt -lt 20 -and -not $passed; $attempt++) {
      $checks = Invoke-Step "gh pr checks $prNumber -R $Repo --required --watch --interval 15" $work
      if ($checks.Code -eq 0) { $passed = $true; break }
      if ($checks.Output -match 'no (required )?checks reported') { Start-Sleep -Seconds 10; continue }
      throw "A required check failed on $prUrl. Fix it, then run this again (delete branch $branch first)."
    }
    if (-not $passed) { throw "The checks on $prUrl did not start." }
    Require (Invoke-Step "gh pr merge $prNumber -R $Repo --merge --admin" $work) 'Merging the pull request' | Out-Null
    Invoke-Step "git push -q origin --delete $branch" $work | Out-Null

    Set-Status "4/5  Tagging $tag and waiting for GitHub to build the installers"
    Require (Invoke-Step 'git fetch -q origin main' $work) 'git fetch' | Out-Null
    $mainVersion = ((Require (Invoke-Step 'git show origin/main:package.json' $work -Quiet) 'Reading main') | ConvertFrom-Json).version
    if ($mainVersion -ne $version) { throw "main is at $mainVersion after the merge, expected $version." }
    $sha = Require (Invoke-Step 'git rev-parse origin/main' $work -Quiet) 'git rev-parse'
    Require (Invoke-Step "git tag -a $tag -m `"Drama Studio $tag`" $sha" $work) 'git tag' | Out-Null
    Require (Invoke-Step "git push -q origin refs/tags/$tag" $work) 'Pushing the tag' | Out-Null
    $runId = ''
    for ($i = 0; $i -lt 40 -and -not $runId; $i++) {
      Start-Sleep -Seconds 6
      $runId = (Invoke-Step "gh run list -R $Repo --workflow release.yml --branch $tag --limit 1 --json databaseId --jq .[0].databaseId" -Quiet).Output
      [System.Windows.Forms.Application]::DoEvents()
    }
    if (-not $runId) { throw "The release build for $tag did not start. Check Actions on GitHub." }
    Add-Log "Release build: https://github.com/$Repo/actions/runs/$runId (about 10-15 minutes)"
    $build = Invoke-Step "gh run watch $runId -R $Repo --exit-status --interval 30" $work -Quiet
    if ($build.Code -ne 0) { throw "The release build failed: https://github.com/$Repo/actions/runs/$runId. The draft stays unpublished." }

    Set-Status "5/5  Writing the release notes"
    $releaseNotes = @"
## Downloads

- ``Windows Installer``: the standard install; updates itself
- ``Windows Portable``: runs without installing
- ``Linux AppImage``: portable Linux build; updates itself
- ``Linux deb``: Debian/Ubuntu package
- ``Mac (Apple Silicon)`` / ``Mac (Intel)``: drag to Applications. Unsigned for now: open it once, then System Settings > Privacy & Security > Open Anyway. Smooth motion is not available in the unsigned Mac build yet.

Ignore the auto-generated source-code archives unless you plan to build Drama Studio from source.

## What's new in $version

$notes

The full list is in [CHANGELOG.md](https://github.com/$Repo/blob/main/CHANGELOG.md).
"@
    $notesFile = Join-Path $LogDir "notes-$version.md"
    Write-Utf8 $notesFile $releaseNotes
    Require (Invoke-Step "gh release edit $tag -R $Repo --notes-file `"$notesFile`"" $work) 'Writing the release notes' | Out-Null
    $assets = (Invoke-Step "gh release view $tag -R $Repo --json assets --jq `"[.assets[].name] | join(\`", \`")`"" -Quiet).Output
    Add-Log "Draft files: $assets"

    $publish = Ask "Publish $tag?" ("The installers for $tag are built and the draft is ready:`r`nhttps://github.com/$Repo/releases/tag/$tag`r`n`r`n" +
      "Publish it now?`r`n`r`n" +
      "  - every installed copy (Windows installer, AppImage) updates itself within hours`r`n" +
      "  - it is announced on Discord`r`n" +
      "  - published files cannot be replaced afterwards`r`n`r`n" +
      "Choose No to keep it as a draft and publish it later on GitHub.")
    if ($publish) {
      Require (Invoke-Step "gh release edit $tag -R $Repo --draft=false --latest" $work) 'Publishing' | Out-Null
      Set-Status "Published $tag."
      Start-Process "https://github.com/$Repo/releases/tag/$tag"
    } else {
      Set-Status "$tag is built and waiting as a draft. Publish it on GitHub when you are ready."
      Start-Process "https://github.com/$Repo/releases"
    }
    Add-Log 'Remember: update the Help Center, README and wiki if this release changed what users see.'
  } catch {
    Show-Error $_.Exception.Message
    Set-Status 'Stopped. See the log above.'
  } finally {
    if (Test-Path $work) {
      Invoke-Step "git worktree remove --force `"$work`"" -Quiet | Out-Null
      # The release branch is on GitHub once pushed, and a stopped run left
      # nothing worth keeping; a leftover would block the next try.
      Invoke-Step "git branch -D $branch" -Quiet | Out-Null
    }
    $script:Busy = $false
    $KindBox.Enabled = $true
    $DryRunBox.Enabled = $true
    Load-State
  }
}

foreach ($radio in $Radios.Values) { $radio.Add_CheckedChanged({ Update-Plan }) }
$GoButton.Add_Click({ Start-Release })
$CloseButton.Add_Click({ $Form.Close() })
$Form.Add_FormClosing({
  param($sender, $e)
  if ($script:Busy) {
    $stop = [System.Windows.Forms.MessageBox]::Show($Form, 'A release step is still running. Stop it and close?', 'Close',
      [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($stop -ne [System.Windows.Forms.DialogResult]::Yes) { $e.Cancel = $true; return }
    $script:Cancelled = $true
  }
})
$Form.Add_Shown({
  try { Load-State } catch { Show-Error $_.Exception.Message }
})

if ($SelfTest) {
  $script:SelfTestFailed = $false
  Load-State
  if (-not $script:SelfTestFailed) { $DryRunBox.Checked = $true; Start-Release }
  if ($script:SelfTestFailed) { exit 1 }
  exit 0
}

[void]$Form.ShowDialog()
