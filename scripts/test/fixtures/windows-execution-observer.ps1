param(
  [Parameter(Mandatory = $true)][int]$SubjectPid,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
  [Parameter(Mandatory = $true)][string]$ObservationNonce
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$subject = $null
$ownedHandle = $null
$clock = [System.Diagnostics.Stopwatch]::StartNew()

function Emit($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

try {
  if ($ObservationNonce -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid fixed observation nonce' }
  $subject = [System.Diagnostics.Process]::GetProcessById($SubjectPid)
  # Force acquisition now. All later exit facts use this retained process object.
  $ownedHandle = $subject.SafeHandle
  if ($ownedHandle.IsInvalid -or $ownedHandle.IsClosed) { throw 'Subject handle was not acquired' }
  $startTime = $subject.StartTime.ToUniversalTime().ToString('O')
  $executable = $subject.MainModule.FileName
  if (-not [String]::Equals([IO.Path]::GetFullPath($executable), [IO.Path]::GetFullPath($ExpectedExecutable),
      [StringComparison]::OrdinalIgnoreCase)) { throw 'Observed subject executable mismatch' }
  if ($subject.HasExited) { throw 'Subject exited before the identity handshake' }
  Emit @{ kind = 'observing'; pid = $SubjectPid; nonce = $ObservationNonce; startTime = $startTime; executable = $executable }
  while (-not $subject.WaitForExit(100)) {
    if ($clock.ElapsedMilliseconds -ge 80000) { throw 'Original subject exit remains unconfirmed' }
  }
  Emit @{ kind = 'exited'; pid = $SubjectPid; nonce = $ObservationNonce; startTime = $startTime;
    hasExited = $subject.HasExited; exitCode = $subject.ExitCode }
} catch {
  Emit @{ kind = 'unknown'; pid = $SubjectPid; nonce = $ObservationNonce; error = $_.Exception.Message }
  exit 2
} finally {
  if ($null -ne $subject) { $subject.Dispose() }
}
