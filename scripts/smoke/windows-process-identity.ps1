param([Parameter(Mandatory = $true)][int]$SubjectPid)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$subject = $null
$ownedHandle = $null

function Emit-Absent {
  [Console]::Out.WriteLine('{"schemaVersion":1,"pid":' + $SubjectPid + ',"status":"absent"}')
}

try {
  try { $subject = [Diagnostics.Process]::GetProcessById($SubjectPid) }
  catch [ArgumentException] { Emit-Absent; return }
  # Bind this observation to one process object, even if the numeric PID is reused.
  $ownedHandle = $subject.SafeHandle
  if ($ownedHandle.IsInvalid -or $ownedHandle.IsClosed) { throw 'Original process handle unavailable' }
  if ($subject.HasExited) { Emit-Absent; return }
  $startTime = $subject.StartTime.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
  if ($subject.HasExited) { Emit-Absent; return }
  [Console]::Out.WriteLine('{"schemaVersion":1,"pid":' + $SubjectPid +
    ',"status":"present","startTime":"' + $startTime + '"}')
} catch {
  $observationError = $_.Exception
  # A retained valid handle can independently confirm an exit racing StartTime.
  if ($null -ne $ownedHandle -and !$ownedHandle.IsInvalid -and !$ownedHandle.IsClosed) {
    try { if ($subject.HasExited) { Emit-Absent; return } } catch { }
  }
  [Console]::Out.WriteLine('{"schemaVersion":1,"pid":' + $SubjectPid +
    ',"status":"unknown","hresult":' + $observationError.HResult + '}')
  exit 2
} finally {
  if ($null -ne $subject) { $subject.Dispose() }
}
