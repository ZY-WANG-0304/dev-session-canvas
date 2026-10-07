$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
foreach ($module in @('Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Management', 'CimCmdlets')) {
  Import-Module -Name ([IO.Path]::Combine($env:PSModulePath, $module, $module + '.psd1')) -ErrorAction Stop
}
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AgentOriginalProcess {
  [StructLayout(LayoutKind.Sequential)] struct BasicInformation {
    public IntPtr Reserved1, PebBaseAddress, Reserved2, Reserved3, UniqueProcessId, ParentProcessId;
  }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(
    SafeProcessHandle process, int kind, out BasicInformation value, int size, out int length);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateProcess(
    SafeProcessHandle process, uint code);
  [DllImport("shell32.dll", SetLastError = true)] static extern IntPtr CommandLineToArgvW(
    [MarshalAs(UnmanagedType.LPWStr)] string text, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static long ParentPid(SafeProcessHandle process) {
    BasicInformation value; int length;
    if (NtQueryInformationProcess(process, 0, out value, Marshal.SizeOf(typeof(BasicInformation)), out length) != 0)
      throw new InvalidOperationException("Parent identity unavailable.");
    return value.ParentProcessId.ToInt64();
  }
  public static string[] Arguments(string text) {
    int count; IntPtr buffer = CommandLineToArgvW(text, out count);
    if (buffer == IntPtr.Zero) throw new InvalidOperationException("Arguments unavailable.");
    try {
      string[] values = new string[count];
      for (int index = 0; index < count; index++)
        values[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer, index * IntPtr.Size));
      return values;
    } finally { LocalFree(buffer); }
  }
}
'@

$originals = @{}
$configuration = $null
$launchArguments = $null
function Same-Path($left, $right) {
  return ![string]::IsNullOrEmpty($left) -and ![string]::IsNullOrEmpty($right) -and
    [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($left), [IO.Path]::GetFullPath($right))
}
function Poll-Original($entry) {
  try {
    $waited = $entry.process.WaitForExit(0)
    $hasExited = $entry.process.HasExited
    if ($waited -and !$hasExited) { throw 'Inconsistent original process wait.' }
    if ($hasExited) {
      $entry.record.hasExited = $true
      $entry.record.exitCode = [int]$entry.process.ExitCode
      $entry.record.exitConfirmed = $true
    }
  } catch {
    $entry.record.observationUnknown = $true
    throw 'Original process observation unavailable.'
  }
}
function Read-Identity($target) {
  $process = $null
  try {
    try { $process = [Diagnostics.Process]::GetProcessById([int]$target.pid) }
    catch [ArgumentException] { return [ordered]@{ pid = [int]$target.pid; status = 'absent' } }
    try {
      $handle = $process.SafeHandle
      if ($handle.IsInvalid -or $handle.IsClosed) { throw 'Invalid process handle.' }
      if ($process.HasExited) { return [ordered]@{ pid = [int]$target.pid; status = 'absent' } }
      $startTime = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
      $executable = $process.MainModule.FileName
      $parentId = [AgentOriginalProcess]::ParentPid($handle)
      if ($process.HasExited) { return [ordered]@{ pid = [int]$target.pid; status = 'absent' } }
      $record = [ordered]@{ pid = [int]$target.pid; ppid = [int]$parentId; startTicks = "win32:$startTime";
        executable = $executable; state = 'R' }
      if ($null -ne $target.startTicks -and $target.startTicks -ne $record.startTicks) {
        $record.state = 'replaced'
      }
      return [ordered]@{ pid = [int]$target.pid; status = 'present'; identity = $record }
    } catch {
      # MainModule may become unavailable after exit while another handle keeps the object alive.
      if ($process.HasExited) { return [ordered]@{ pid = [int]$target.pid; status = 'absent' } }
      throw
    } finally { $process.Dispose() }
  } catch { return [ordered]@{ pid = [int]$target.pid; status = 'unknown' } }
}
function Acquire-Original($processId, $role, $expectedExecutable, $parent, $wrapperKind, $candidate) {
  $process = $null
  try {
    $process = [Diagnostics.Process]::GetProcessById([int]$processId)
    $handle = $process.SafeHandle
    if ($handle.IsInvalid -or $handle.IsClosed) { throw 'Invalid original handle.' }
    $startTime = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
    $executable = $process.MainModule.FileName
    $parentId = [AgentOriginalProcess]::ParentPid($handle)
    if (!(Same-Path $executable $expectedExecutable)) { throw 'Executable identity mismatch.' }
    $parentStart = $null
    if ($null -ne $parent) {
      Poll-Original $parent
      if ($parent.record.hasExited -or $parent.record.observationUnknown -or
        $parentId -ne $parent.record.pid -or $startTime -lt $parent.startTime) {
        throw 'Original parent identity unavailable.'
      }
      $parentStart = $parent.record.startTicks
    }
    if ($null -ne $candidate) {
      # Bind CIM's launch facts to the lifetime of this retained object, not a recycled discovery PID.
      if ($process.HasExited) { throw 'Original subject already ended before launch verification.' }
      $current = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId" -Property ProcessId, ParentProcessId, ExecutablePath, CommandLine)
      if ($current.Count -ne 1 -or $current[0].ParentProcessId -ne $parentId -or
        !(Same-Path $current[0].ExecutablePath $executable) -or
        ![StringComparer]::Ordinal.Equals($current[0].CommandLine, $candidate.CommandLine) -or $process.HasExited) {
        throw 'Launch facts do not belong to the retained live original.'
      }
    }
    $key = "${processId}:win32:$startTime"
    if ($originals.ContainsKey($key)) { $process.Dispose(); return }
    $record = [ordered]@{ pid = [int]$processId; ppid = [int]$parentId; startTicks = "win32:$startTime";
      executable = $executable; role = $role; firstPpid = [int]$parentId; firstParentStartTicks = $parentStart;
      hasExited = $false; exitConfirmed = $false; exitCode = $null; observationUnknown = $false }
    if ($wrapperKind) { $record.wrapperKind = $wrapperKind }
    $entry = @{ process = $process; handle = $handle; record = $record; startTime = $startTime }
    $originals[$key] = $entry
    Poll-Original $entry
  } catch {
    if ($null -ne $process -and !($originals.Values | Where-Object { $_.process -eq $process })) { $process.Dispose() }
    throw 'Fixed startup identity could not be retained.'
  }
}
function Discover-StartupChain {
  # CIM only discovers candidates. Ownership and exit facts use the retained original handles.
  $candidates = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, ExecutablePath, CommandLine)
  for ($depth = 0; $depth -lt 4; $depth++) {
    foreach ($parent in @($originals.Values)) {
      Poll-Original $parent
      if ($parent.record.hasExited) { continue }
      foreach ($candidate in $candidates) {
        if ($candidate.ParentProcessId -ne $parent.record.pid) { continue }
        if (@($originals.Values | Where-Object { $_.record.pid -eq $candidate.ProcessId }).Count) { continue }
        $role = $null; $wrapperKind = $null; $expected = $null
        if ($parent.record.role -in @('host', 'supervisor') -and
          (Same-Path $candidate.ExecutablePath $configuration.rootExecutable)) {
          $argv = [AgentOriginalProcess]::Arguments($candidate.CommandLine)
          if ($argv.Length -eq 8 -and (Same-Path $argv[1] $configuration.providerPath)) {
            $role = 'provider'; $expected = $configuration.rootExecutable
          }
        } elseif ($parent.record.role -eq 'provider' -and
          (Same-Path $candidate.ExecutablePath $configuration.commandShell)) {
          $match = [regex]::Match($candidate.CommandLine, '^(?:"[^"]*"|\S+)\s+(?<tail>.*)$')
          if ($null -ne $launchArguments -and $match.Success -and
            [StringComparer]::Ordinal.Equals($match.Groups['tail'].Value, $launchArguments)) {
            $role = 'wrapper'; $wrapperKind = 'cmd'; $expected = $configuration.commandShell
          }
        } elseif ($parent.record.role -eq 'wrapper' -and $parent.record.wrapperKind -eq 'cmd' -and
          $configuration.cli.provider -eq 'codex' -and
          (Same-Path $candidate.ExecutablePath $configuration.cli.nodeExecutable)) {
          $argv = [AgentOriginalProcess]::Arguments($candidate.CommandLine)
          if ($argv.Length -ge 2 -and (Same-Path $argv[1] $configuration.cli.nodeWrapper)) {
            $role = 'wrapper'; $wrapperKind = 'node'; $expected = $configuration.cli.nodeExecutable
          }
        } elseif ($parent.record.role -eq 'wrapper' -and
          (($configuration.cli.provider -eq 'codex' -and $parent.record.wrapperKind -eq 'node') -or
           ($configuration.cli.provider -eq 'claude' -and $parent.record.wrapperKind -eq 'cmd')) -and
          (Same-Path $candidate.ExecutablePath $configuration.cli.nativeExecutable)) {
          $role = 'cli'; $expected = $configuration.cli.nativeExecutable
        }
        if ($role) { Acquire-Original $candidate.ProcessId $role $expected $parent $wrapperKind $candidate }
      }
    }
  }
}
function Records {
  # Poll parents before children so a later child observation can establish a wrapper lifecycle violation.
  $ordered = @($originals.Values | Sort-Object @{ Expression = {
    switch ($_.record.role) { 'host' { 0 } 'supervisor' { 0 } 'provider' { 1 }
      'wrapper' { if ($_.record.wrapperKind -eq 'cmd') { 2 } else { 3 } } 'cli' { 4 } }
  } })
  foreach ($entry in $ordered) { Poll-Original $entry; $entry.record }
}
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      $request = $line | ConvertFrom-Json
      if ($request.version -ne 1 -or $request.id -lt 1) { throw 'Invalid fixed request.' }
      $actions = @()
      $identityRecords = @()
      switch ($request.operation) {
        'initialize' {
          if ($null -ne $configuration -or $request.cli.provider -notin @('codex', 'claude')) { throw 'Invalid initialization.' }
          foreach ($file in @($request.providerPath, $request.rootExecutable, $request.commandShell,
            $request.cli.entry, $request.cli.nativeExecutable, $request.cli.nodeExecutable)) {
            if (![IO.Path]::IsPathRooted($file) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Missing fixed asset.' }
          }
          $configuration = $request
        }
        'launch' {
          if ($null -eq $configuration -or $null -ne $launchArguments -or
            !($request.commandArguments -is [string]) -or !$request.commandArguments.StartsWith('/d /s /c ')) {
            throw 'Invalid fixed launch.'
          }
          $launchArguments = $request.commandArguments
        }
        'root' {
          if ($null -eq $configuration -or $request.role -notin @('host', 'supervisor')) { throw 'Invalid root.' }
          Acquire-Original $request.pid $request.role $configuration.rootExecutable $null $null $null
        }
        'identity' {
          if ($null -eq $request.targets -or @($request.targets).Count -gt 64) { throw 'Invalid identity request.' }
          foreach ($target in @($request.targets)) {
            if ($null -eq $target.pid -or [int]$target.pid -le 0) { throw 'Invalid identity PID.' }
            $identityRecords += Read-Identity $target
          }
        }
        'sample' {
          if ($null -eq $configuration) { throw 'Uninitialized helper.' }
          Discover-StartupChain
        }
        'cleanup' {
          # Validate the entire request before sending any signal; never reopen a PID for cleanup.
          $targets = @($request.targets)
          foreach ($target in $targets) {
            $key = "$($target.pid):$($target.startTicks)"
            $entry = $originals[$key]
            if ($null -eq $entry -or $target.role -notin @('cli', 'wrapper', 'provider', 'supervisor') -or
              $entry.record.role -ne $target.role -or !(Same-Path $entry.record.executable $target.executable) -or
              $entry.record.observationUnknown) { throw 'Unowned cleanup target.' }
            Poll-Original $entry
          }
          foreach ($target in $targets) {
            $entry = $originals["$($target.pid):$($target.startTicks)"]
            $action = 'already-exited'
            if (!$entry.record.hasExited) {
              if (![AgentOriginalProcess]::TerminateProcess($entry.handle, 1)) { throw 'Original handle termination failed.' }
              $action = 'terminated-original-handle'
            }
            $actions += @{ pid = $target.pid; startTicks = $target.startTicks; action = $action }
          }
        }
        default { throw 'Unsupported fixed request.' }
      }
      $response = if ($request.operation -eq 'identity') {
        @{ version = 1; id = $request.id; records = @($identityRecords) }
      } else {
        @{ version = 1; id = $request.id; records = @(Records); actions = $actions }
      }
    } catch {
      $response = @{ version = 1; id = $request.id; error = 'original-process-evidence-unavailable' }
    }
    [Console]::WriteLine(($response | ConvertTo-Json -Compress -Depth 12))
  }
} finally {
  foreach ($entry in $originals.Values) { $entry.process.Dispose() }
}
