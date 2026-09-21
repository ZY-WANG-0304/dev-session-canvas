#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define DSC_SESSIONS 23
#define DSC_PATH_CHARS 32768
#define DSC_NS_PER_MS 1000000ULL
#define DSC_NS_PER_SECOND 1000000000ULL

typedef struct {
  HANDLE process;
  HANDLE thread;
  DWORD pid;
  DWORD thread_id;
  DWORD expected_exit;
  ULONGLONG creation;
  int index;
} dsc_owner;

typedef struct {
  const char *mode;
  int run;
  DWORD pid;
  LARGE_INTEGER frequency;
  LARGE_INTEGER started;
  unsigned int sequence;
  unsigned int failures;
  unsigned int created;
  unsigned int thread_closed;
  unsigned int process_closed;
  unsigned int forced_terminations;
  int clock_failed;
  int output_failed;
  WCHAR executable[DSC_PATH_CHARS];
  dsc_owner owners[DSC_SESSIONS];
} dsc_context;

static const char *dsc_bool(int value) { return value ? "true" : "false"; }

static ULONGLONG dsc_filetime(FILETIME value) {
  return ((ULONGLONG)value.dwHighDateTime << 32) | value.dwLowDateTime;
}

static void dsc_json_string(const char *text) {
  const unsigned char *cursor = (const unsigned char *)text;
  putchar('"');
  while (*cursor) {
    unsigned int character = *cursor++;
    if (character == '"' || character == '\\') printf("\\%c", (int)character);
    else if (character < 32) printf("\\u%04x", character);
    else putchar((int)character);
  }
  putchar('"');
}

static char *dsc_utf8(const WCHAR *text, DWORD *error) {
  int length;
  char *result;
  *error = 0;
  length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, NULL, 0, NULL, NULL);
  if (!length) { *error = GetLastError(); return NULL; }
  result = (char *)malloc((size_t)length);
  if (!result) { *error = ERROR_NOT_ENOUGH_MEMORY; return NULL; }
  if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result, length, NULL, NULL)) {
    *error = GetLastError(); free(result); return NULL;
  }
  return result;
}

static ULONGLONG dsc_now(dsc_context *context, LARGE_INTEGER *ticks) {
  ULONGLONG elapsed, frequency;
  if (!QueryPerformanceCounter(ticks) || ticks->QuadPart < context->started.QuadPart) {
    context->clock_failed = 1;
    ticks->QuadPart = context->started.QuadPart;
    return 0;
  }
  elapsed = (ULONGLONG)(ticks->QuadPart - context->started.QuadPart);
  frequency = (ULONGLONG)context->frequency.QuadPart;
  return (elapsed / frequency) * DSC_NS_PER_SECOND + ((elapsed % frequency) * DSC_NS_PER_SECOND) / frequency;
}

static ULONGLONG dsc_begin(dsc_context *context, const char *event) {
  LARGE_INTEGER ticks;
  ULONGLONG now = dsc_now(context, &ticks);
  printf("{\"schema\":1,\"event\":"); dsc_json_string(event);
  printf(",\"seq\":%u,\"driverPid\":%lu,\"elapsedNs\":\"%llu\",\"qpcTicks\":\"%llu\"",
    context->sequence++, (unsigned long)context->pid, (unsigned long long)now,
    (unsigned long long)ticks.QuadPart);
  return now;
}

static void dsc_end(dsc_context *context) {
  fputs("}\n", stdout);
  if (fflush(stdout) == EOF || ferror(stdout)) context->output_failed = 1;
}

static void dsc_owner_fields(const dsc_owner *owner) {
  printf(",\"sessionIndex\":%d,\"ownerId\":\"session-%d\"", owner->index, owner->index);
}

static void dsc_failure(dsc_context *context, const char *operation, const dsc_owner *owner,
                         DWORD error, const char *reason) {
  context->failures++;
  dsc_begin(context, "failure");
  printf(",\"operation\":"); dsc_json_string(operation);
  if (owner) dsc_owner_fields(owner); else fputs(",\"ownerId\":null", stdout);
  printf(",\"error\":%lu,\"reason\":", (unsigned long)error); dsc_json_string(reason);
  dsc_end(context);
}

static int dsc_sleep_until(dsc_context *context, ULONGLONG deadline) {
  LARGE_INTEGER ticks;
  for (;;) {
    ULONGLONG now = dsc_now(context, &ticks), remaining;
    DWORD milliseconds;
    if (context->clock_failed) {
      dsc_failure(context, "QueryPerformanceCounter", NULL, 0, "Monotonic clock unavailable");
      return 0;
    }
    if (now >= deadline) return !context->output_failed;
    remaining = deadline - now;
    milliseconds = (DWORD)((remaining + DSC_NS_PER_MS - 1) / DSC_NS_PER_MS);
    Sleep(milliseconds);
  }
}

static unsigned int dsc_owned_processes(const dsc_context *context) {
  unsigned int count = 0;
  int index;
  for (index = 0; index < DSC_SESSIONS; index++) if (context->owners[index].process) count++;
  return count;
}

static int dsc_snapshot_group(dsc_context *context, const char *group, const char *phase, int session_index) {
  unsigned int sample;
  ULONGLONG last = dsc_begin(context, "snapshot-group-begin");
  printf(",\"groupId\":"); dsc_json_string(group);
  printf(",\"phase\":"); dsc_json_string(phase);
  if (session_index >= 0) printf(",\"sessionIndex\":%d", session_index);
  else fputs(",\"sessionIndex\":null", stdout);
  printf(",\"ownedProcessHandles\":%u", dsc_owned_processes(context));
  dsc_end(context);
  if (!dsc_sleep_until(context, last + 100 * DSC_NS_PER_MS)) return 0;
  for (sample = 0; sample < 5; sample++) {
    DWORD handles = 0;
    BOOL ok = GetProcessHandleCount(GetCurrentProcess(), &handles);
    DWORD error = ok ? 0 : GetLastError();
    last = dsc_begin(context, "snapshot");
    printf(",\"groupId\":"); dsc_json_string(group);
    printf(",\"sample\":%u,\"handles\":%lu,\"ok\":%s,\"error\":%lu", sample,
      (unsigned long)handles, dsc_bool(ok), (unsigned long)error);
    dsc_end(context);
    if (!ok) { dsc_failure(context, "GetProcessHandleCount", NULL, error, "Snapshot failed"); return 0; }
    if (sample < 4 && !dsc_sleep_until(context, last + 20 * DSC_NS_PER_MS)) return 0;
  }
  return !context->clock_failed && !context->output_failed;
}

static int dsc_inspect(dsc_context *context, dsc_owner *owner, const char *phase, int inspection,
                       ULONGLONG *emitted) {
  DWORD wait_result, wait_error, pid, pid_error, exit_code = 0, exit_error, times_error, image_error, conversion_error = 0;
  DWORD image_size = DSC_PATH_CHARS;
  BOOL exit_ok, times_ok, image_ok = FALSE, image_attempted = FALSE;
  FILETIME creation = {0}, exit_time = {0}, kernel = {0}, user = {0};
  WCHAR *image = NULL;
  char *image_utf8 = NULL;
  int suspended = strcmp(phase, "suspended") == 0;
  if (!owner->process) { dsc_failure(context, "inspect", owner, 0, "Owner is already closed"); return 0; }
  wait_result = WaitForSingleObject(owner->process, 0); wait_error = wait_result == WAIT_FAILED ? GetLastError() : 0;
  pid = GetProcessId(owner->process); pid_error = pid ? 0 : GetLastError();
  exit_ok = GetExitCodeProcess(owner->process, &exit_code); exit_error = exit_ok ? 0 : GetLastError();
  times_ok = GetProcessTimes(owner->process, &creation, &exit_time, &kernel, &user); times_error = times_ok ? 0 : GetLastError();
  image = (WCHAR *)calloc(DSC_PATH_CHARS, sizeof(WCHAR));
  if (image) {
    image_attempted = TRUE;
    image_ok = QueryFullProcessImageNameW(owner->process, 0, image, &image_size);
    image_error = image_ok ? 0 : GetLastError();
    if (image_ok) image_utf8 = dsc_utf8(image, &conversion_error);
  } else image_error = ERROR_NOT_ENOUGH_MEMORY;
  *emitted = dsc_begin(context, "process-inspection");
  dsc_owner_fields(owner);
  printf(",\"hProcess\":\"0x%llx\",\"phase\":", (unsigned long long)(uintptr_t)owner->process);
  dsc_json_string(phase);
  if (inspection >= 0) printf(",\"inspection\":%d", inspection); else fputs(",\"inspection\":null", stdout);
  printf(",\"wait\":{\"result\":%lu,\"error\":%lu,\"timeoutMs\":0}", (unsigned long)wait_result, (unsigned long)wait_error);
  printf(",\"pidQuery\":{\"ok\":%s,\"value\":%lu,\"error\":%lu}", dsc_bool(pid != 0), (unsigned long)pid, (unsigned long)pid_error);
  printf(",\"exitCodeQuery\":{\"ok\":%s,\"value\":%lu,\"error\":%lu}", dsc_bool(exit_ok), (unsigned long)exit_code, (unsigned long)exit_error);
  printf(",\"timesQuery\":{\"ok\":%s,\"creationTime\":\"0x%016llx\",\"exitTime\":\"0x%016llx\","
    "\"kernelTime\":\"0x%016llx\",\"userTime\":\"0x%016llx\",\"error\":%lu}", dsc_bool(times_ok),
    (unsigned long long)dsc_filetime(creation), (unsigned long long)dsc_filetime(exit_time),
    (unsigned long long)dsc_filetime(kernel), (unsigned long long)dsc_filetime(user), (unsigned long)times_error);
  printf(",\"imageQuery\":{\"attempted\":%s,\"ok\":%s,\"path\":", dsc_bool(image_attempted), dsc_bool(image_ok));
  if (image_utf8) dsc_json_string(image_utf8); else fputs("null", stdout);
  printf(",\"error\":%lu", (unsigned long)image_error);
  if (conversion_error) printf(",\"serializationError\":%lu", (unsigned long)conversion_error);
  fputs("}", stdout); dsc_end(context);
  free(image_utf8); free(image);
  if (!pid || !exit_ok || !times_ok || wait_result == WAIT_FAILED) {
    DWORD error = pid_error ? pid_error : exit_error ? exit_error : times_error ? times_error : wait_error;
    dsc_failure(context, "process-inspection", owner, error, "Required process query failed"); return 0;
  }
  if (!image_attempted) { dsc_failure(context, "image-allocation", owner, ERROR_NOT_ENOUGH_MEMORY, "Image buffer allocation failed before query"); return 0; }
  if (conversion_error) { dsc_failure(context, "WideCharToMultiByte", owner, conversion_error, "Image serialization failed"); return 0; }
  if (pid != owner->pid || wait_result != (suspended ? WAIT_TIMEOUT : WAIT_OBJECT_0) ||
      exit_code != (suspended ? STILL_ACTIVE : owner->expected_exit)) {
    dsc_failure(context, "process-inspection", owner, 0, "Unexpected process identity or execution state"); return 0;
  }
  if (suspended) owner->creation = dsc_filetime(creation);
  else if (dsc_filetime(creation) != owner->creation) {
    dsc_failure(context, "GetProcessTimes", owner, 0, "Owned process creation time changed"); return 0;
  }
  return !context->clock_failed && !context->output_failed;
}

static int dsc_close_thread(dsc_context *context, dsc_owner *owner, int cleanup) {
  HANDLE handle = owner->thread;
  BOOL ok;
  DWORD error;
  if (!handle) { dsc_failure(context, "CloseHandle(hThread)", owner, 0, "Thread owner already cleared"); return 0; }
  ok = CloseHandle(handle); error = ok ? 0 : GetLastError();
  owner->thread = NULL;
  if (ok) context->thread_closed++;
  dsc_begin(context, "thread-closed"); dsc_owner_fields(owner);
  printf(",\"hThread\":\"0x%llx\",\"ok\":%s,\"error\":%lu,\"cleanup\":%s",
    (unsigned long long)(uintptr_t)handle, dsc_bool(ok), (unsigned long)error, dsc_bool(cleanup));
  dsc_end(context);
  if (!ok) dsc_failure(context, "CloseHandle(hThread)", owner, error, "Single close attempt failed; owner cleared without retry");
  return ok != 0;
}

static int dsc_close_process(dsc_context *context, dsc_owner *owner, int cleanup) {
  HANDLE handle = owner->process;
  BOOL ok;
  DWORD error;
  if (!handle) { dsc_failure(context, "CloseHandle(hProcess)", owner, 0, "Process owner already cleared"); return 0; }
  ok = CloseHandle(handle); error = ok ? 0 : GetLastError();
  owner->process = NULL;
  if (ok) context->process_closed++;
  dsc_begin(context, "process-closed"); dsc_owner_fields(owner);
  printf(",\"hProcess\":\"0x%llx\",\"ok\":%s,\"error\":%lu,\"cleanup\":%s",
    (unsigned long long)(uintptr_t)handle, dsc_bool(ok), (unsigned long)error, dsc_bool(cleanup));
  dsc_end(context);
  if (!ok) dsc_failure(context, "CloseHandle(hProcess)", owner, error, "Single close attempt failed; owner cleared without retry");
  return ok != 0;
}

static int dsc_wait_process(dsc_context *context, dsc_owner *owner, int cleanup) {
  DWORD result = WaitForSingleObject(owner->process, 5000);
  DWORD error = result == WAIT_FAILED ? GetLastError() : 0;
  dsc_begin(context, "process-wait"); dsc_owner_fields(owner);
  printf(",\"timeoutMs\":5000,\"result\":%lu,\"ok\":%s,\"error\":%lu,\"cleanup\":%s",
    (unsigned long)result, dsc_bool(result == WAIT_OBJECT_0), (unsigned long)error, dsc_bool(cleanup));
  dsc_end(context);
  if (result != WAIT_OBJECT_0) { dsc_failure(context, "WaitForSingleObject", owner, error, "Known child did not signal inside 5 seconds"); return 0; }
  return !context->clock_failed && !context->output_failed;
}

static int dsc_create_session(dsc_context *context, dsc_owner *owner) {
  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  WCHAR *command;
  BOOL created;
  DWORD error, resume;
  ULONGLONG last;
  int length, inspection;
  memset(&startup, 0, sizeof(startup)); memset(&process, 0, sizeof(process));
  startup.cb = (DWORD)sizeof(startup);
  command = (WCHAR *)calloc(DSC_PATH_CHARS, sizeof(WCHAR));
  if (!command) { dsc_failure(context, "command-allocation", owner, ERROR_NOT_ENOUGH_MEMORY, "Command allocation failed"); return 0; }
  length = _snwprintf_s(command, DSC_PATH_CHARS, _TRUNCATE, L"\"%ls\" --child %lu", context->executable, (unsigned long)owner->expected_exit);
  if (length < 0) { free(command); dsc_failure(context, "command-format", owner, ERROR_INSUFFICIENT_BUFFER, "Child command too long"); return 0; }
  created = CreateProcessW(context->executable, command, NULL, NULL, FALSE, CREATE_SUSPENDED | CREATE_NO_WINDOW,
    NULL, NULL, &startup, &process);
  error = created ? 0 : GetLastError(); free(command);
  if (created) {
    owner->process = process.hProcess; owner->thread = process.hThread;
    owner->pid = process.dwProcessId; owner->thread_id = process.dwThreadId;
    context->created++;
  }
  dsc_begin(context, "child-created"); dsc_owner_fields(owner);
  printf(",\"pid\":%lu,\"threadId\":%lu,\"hProcess\":\"0x%llx\",\"hThread\":\"0x%llx\","
    "\"flags\":%lu,\"inheritHandles\":false,\"ok\":%s,\"error\":%lu",
    (unsigned long)owner->pid, (unsigned long)owner->thread_id, (unsigned long long)(uintptr_t)owner->process,
    (unsigned long long)(uintptr_t)owner->thread, (unsigned long)(CREATE_SUSPENDED | CREATE_NO_WINDOW), dsc_bool(created), (unsigned long)error);
  dsc_end(context);
  if (!created) { dsc_failure(context, "CreateProcessW", owner, error, "Child creation failed"); return 0; }
  if (!dsc_inspect(context, owner, "suspended", -1, &last)) return 0;
  resume = ResumeThread(owner->thread); error = resume == (DWORD)-1 ? GetLastError() : 0;
  dsc_begin(context, "child-resumed"); dsc_owner_fields(owner);
  printf(",\"previousSuspendCount\":%lu,\"ok\":%s,\"error\":%lu", (unsigned long)resume,
    dsc_bool(resume != (DWORD)-1), (unsigned long)error); dsc_end(context);
  if (resume != 1) { dsc_failure(context, "ResumeThread", owner, error, "Expected one initial suspension"); return 0; }
  if (!dsc_close_thread(context, owner, 0) || !dsc_wait_process(context, owner, 0)) return 0;
  if (!dsc_inspect(context, owner, "exited", -1, &last)) return 0;
  for (inspection = 0; inspection < 3; inspection++) {
    if (inspection && !dsc_sleep_until(context, last + 50 * DSC_NS_PER_MS)) return 0;
    if (!dsc_inspect(context, owner, "retained", inspection, &last)) return 0;
  }
  return 1;
}

static void dsc_cleanup(dsc_context *context) {
  int index;
  for (index = 0; index < DSC_SESSIONS; index++) {
    dsc_owner *owner = &context->owners[index];
    if (owner->process) {
      DWORD wait_result = WaitForSingleObject(owner->process, 0);
      DWORD wait_error = wait_result == WAIT_FAILED ? GetLastError() : 0;
      dsc_begin(context, "cleanup-state"); dsc_owner_fields(owner);
      printf(",\"hProcess\":\"0x%llx\",\"wait\":{\"result\":%lu,\"error\":%lu,\"timeoutMs\":0}",
        (unsigned long long)(uintptr_t)owner->process, (unsigned long)wait_result, (unsigned long)wait_error);
      dsc_end(context);
      if (wait_result == WAIT_TIMEOUT) {
        BOOL ok = TerminateProcess(owner->process, 99);
        DWORD error = ok ? 0 : GetLastError();
        context->forced_terminations++;
        dsc_begin(context, "cleanup-terminate"); dsc_owner_fields(owner);
        printf(",\"pid\":%lu,\"ok\":%s,\"error\":%lu", (unsigned long)owner->pid, dsc_bool(ok), (unsigned long)error);
        dsc_end(context);
        dsc_failure(context, "TerminateProcess", owner, error, "Forced cleanup is not natural completion");
        if (ok) (void)dsc_wait_process(context, owner, 1);
      } else if (wait_result != WAIT_OBJECT_0) {
        dsc_failure(context, "WaitForSingleObject(cleanup)", owner, wait_error, "Cannot establish child execution state; no termination attempted");
      }
    }
    if (owner->thread) (void)dsc_close_thread(context, owner, 1);
    if (owner->process) (void)dsc_close_process(context, owner, 1);
  }
}

static int dsc_driver(const char *mode, int run) {
  dsc_context *context = (dsc_context *)calloc(1, sizeof(dsc_context));
  DWORD path_length, path_error, conversion_error;
  char *executable;
  int index, complete = 0, control = strcmp(mode, "control") == 0;
  int retain = strcmp(mode, "retain-until-end") == 0;
  if (!context) { fputs("Driver allocation failed\n", stderr); return 1; }
  context->mode = mode; context->run = run; context->pid = GetCurrentProcessId();
  if (!QueryPerformanceFrequency(&context->frequency) || context->frequency.QuadPart <= 0 ||
      (ULONGLONG)context->frequency.QuadPart > UINT64_MAX / DSC_NS_PER_SECOND || !QueryPerformanceCounter(&context->started)) {
    fputs("Unsupported monotonic clock\n", stderr); free(context); return 1;
  }
  path_length = GetModuleFileNameW(NULL, context->executable, DSC_PATH_CHARS);
  path_error = GetLastError();
  if (!path_length || path_length >= DSC_PATH_CHARS) {
    fprintf(stderr, "Executable path unavailable: %lu\n", (unsigned long)path_error); free(context); return 1;
  }
  executable = dsc_utf8(context->executable, &conversion_error);
  if (!executable) { fprintf(stderr, "Executable encoding failed: %lu\n", (unsigned long)conversion_error); free(context); return 1; }
  dsc_begin(context, "driver-start");
  printf(",\"mode\":"); dsc_json_string(mode);
  printf(",\"run\":%d,\"executable\":", run); dsc_json_string(executable);
  printf(",\"qpcFrequency\":\"%llu\",\"settings\":{\"warmup\":3,\"measured\":20,\"inspections\":3,"
    "\"inspectionIntervalMs\":50,\"settleMs\":100,\"snapshots\":5,\"snapshotIntervalMs\":20,\"waitMs\":5000}",
    (unsigned long long)context->frequency.QuadPart); dsc_end(context); free(executable);
  if (!dsc_snapshot_group(context, "initial", "initial", -1)) goto finished;
  for (index = 0; index < DSC_SESSIONS; index++) {
    dsc_owner *owner = &context->owners[index];
    owner->index = index; owner->expected_exit = (DWORD)(index % 2 ? 7 : 0);
    dsc_begin(context, "session-begin");
    printf(",\"sessionIndex\":%d,\"expectedExit\":%lu,\"phase\":\"%s\"", index,
      (unsigned long)owner->expected_exit, index < 3 ? "warmup" : "measured"); dsc_end(context);
    if (control) {
      int inspection;
      ULONGLONG last = 0;
      for (inspection = 0; inspection < 3; inspection++) {
        if (inspection && !dsc_sleep_until(context, last + 50 * DSC_NS_PER_MS)) goto finished;
        last = dsc_begin(context, "control-inspection");
        printf(",\"sessionIndex\":%d,\"inspection\":%d", index, inspection); dsc_end(context);
      }
    } else {
      if (!dsc_create_session(context, owner)) goto finished;
      if (!retain && !dsc_close_process(context, owner, 0)) goto finished;
    }
    dsc_begin(context, "session-complete");
    if (control) printf(",\"sessionIndex\":%d,\"ownerId\":null", index); else dsc_owner_fields(owner);
    printf(",\"retained\":%s,\"ownedProcessHandles\":%u", dsc_bool(retain && !control), dsc_owned_processes(context));
    dsc_end(context);
    if (index == 2) {
      if (!dsc_snapshot_group(context, "warmup", "warmup", index)) goto finished;
    } else if (index > 2) {
      char group[32];
      snprintf(group, sizeof(group), "measured-%d", index);
      if (!dsc_snapshot_group(context, group, "measured", index)) goto finished;
    }
  }
  if (retain) {
    dsc_begin(context, "final-release-begin"); fputs(",\"ownerIds\":[", stdout);
    for (index = 0; index < DSC_SESSIONS; index++) printf("%s\"session-%d\"", index ? "," : "", index);
    fputs("]", stdout); dsc_end(context);
    for (index = 0; index < DSC_SESSIONS; index++)
      if (!dsc_close_process(context, &context->owners[index], 0)) goto finished;
  }
  complete = 1;

finished:
  if (!complete || context->failures || context->clock_failed || context->output_failed) dsc_cleanup(context);
  if (context->clock_failed && !context->failures) dsc_failure(context, "QueryPerformanceCounter", NULL, 0, "Monotonic clock failed");
  if (!context->clock_failed && !context->output_failed) (void)dsc_snapshot_group(context, "final", "final", -1);
  dsc_begin(context, "driver-complete");
  printf(",\"ok\":%s,\"created\":%u,\"threadClosed\":%u,\"processClosed\":%u,\"retainedCount\":%u,"
    "\"forcedTerminations\":%u,\"failures\":%u", dsc_bool(complete && !context->failures && !context->clock_failed && !context->output_failed),
    context->created, context->thread_closed, context->process_closed, dsc_owned_processes(context),
    context->forced_terminations, context->failures); dsc_end(context);
  {
    int result = context->output_failed ? 2 : complete && !context->failures && !context->clock_failed ? 0 : 1;
    free(context); return result;
  }
}

int wmain(int argc, WCHAR **argv) {
  if (argc == 3 && !wcscmp(argv[1], L"--child")) {
    if (!wcscmp(argv[2], L"0")) return 0;
    if (!wcscmp(argv[2], L"7")) return 7;
  }
  if (argc == 5 && !wcscmp(argv[1], L"--driver") && !wcscmp(argv[3], L"--run")) {
    const char *mode = !wcscmp(argv[2], L"control") ? "control" : !wcscmp(argv[2], L"release-each") ? "release-each" :
      !wcscmp(argv[2], L"retain-until-end") ? "retain-until-end" : NULL;
    int run = !wcscmp(argv[4], L"1") ? 1 : !wcscmp(argv[4], L"2") ? 2 : 0;
    if (mode && run) return dsc_driver(mode, run);
  }
  fputs("Usage: --driver <control|release-each|retain-until-end> --run <1|2>\n", stderr);
  return 2;
}
