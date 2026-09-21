#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

#define DSC_RUN_LENGTH 32
#define DSC_WIRE_LIMIT 512
#define DSC_TTL_MS 3000ULL
#define DSC_MARKER_BYTES 40

typedef struct {
  HANDLE control;
  HANDLE output;
  HANDLE error_output;
  DWORD pid;
  unsigned int sequence;
  LARGE_INTEGER frequency;
  LONGLONG last_ticks;
  ULONGLONG deadline;
  char run[DSC_RUN_LENGTH + 1];
  const char *mode;
} dsc_context;

static int dsc_hex(const char *text) {
  size_t index;
  if (strlen(text) != DSC_RUN_LENGTH) return 0;
  for (index = 0; index < DSC_RUN_LENGTH; index++) {
    if (!((text[index] >= '0' && text[index] <= '9') ||
          (text[index] >= 'a' && text[index] <= 'f'))) return 0;
  }
  return 1;
}

static int dsc_wide_hex(const wchar_t *text, char *destination) {
  size_t index;
  if (wcslen(text) != DSC_RUN_LENGTH) return 0;
  for (index = 0; index < DSC_RUN_LENGTH; index++) {
    if (!((text[index] >= L'0' && text[index] <= L'9') ||
          (text[index] >= L'a' && text[index] <= L'f'))) return 0;
    if (destination) destination[index] = (char)text[index];
  }
  if (destination) destination[DSC_RUN_LENGTH] = '\0';
  return 1;
}

static void dsc_copy_token(char *destination, const char *source) {
  size_t index;
  for (index = 0; index <= DSC_RUN_LENGTH; index++) destination[index] = source[index];
}

static int dsc_send(dsc_context *context, const char *type, const char *suffix) {
  LARGE_INTEGER ticks;
  char record[DSC_WIRE_LIMIT];
  int length;
  DWORD written = 0;
  if (!QueryPerformanceCounter(&ticks) || ticks.QuadPart < context->last_ticks) return 0;
  context->last_ticks = ticks.QuadPart;
  length = snprintf(record, sizeof(record), "DSCG07/1\t%s\t%s\t%u\t%lu\t%llu\t%llu\t%s\n",
    type, context->run, ++context->sequence, (unsigned long)context->pid,
    (unsigned long long)ticks.QuadPart, (unsigned long long)context->frequency.QuadPart, suffix);
  if (length <= 0 || (size_t)length >= sizeof(record)) return 0;
  return WriteFile(context->control, record, (DWORD)length, &written, NULL) && written == (DWORD)length;
}

static __declspec(noreturn) void dsc_fail(dsc_context *context, const char *operation, DWORD error) {
  char suffix[128];
  int length = snprintf(suffix, sizeof(suffix), "%s\t%lu", operation, (unsigned long)error);
  if (length > 0 && (size_t)length < sizeof(suffix) && context->control != INVALID_HANDLE_VALUE)
    (void)dsc_send(context, "ERROR", suffix);
  ExitProcess(70);
}

static void dsc_emit(dsc_context *context, const char *type, const char *suffix) {
  if (!dsc_send(context, type, suffix)) ExitProcess(74);
}

static DWORD WINAPI dsc_watchdog(void *argument) {
  const dsc_context *context = (const dsc_context *)argument;
  for (;;) {
    ULONGLONG now = GetTickCount64();
    if (now >= context->deadline) ExitProcess(124);
    Sleep((DWORD)(context->deadline - now));
  }
}

static void dsc_read_command(dsc_context *context, char *line, char **fields) {
  size_t length = 0;
  size_t count = 1;
  size_t index;
  fields[0] = line;
  for (;;) {
    char character;
    DWORD received = 0;
    BOOL success = ReadFile(context->control, &character, 1, &received, NULL);
    DWORD error = success ? 0 : GetLastError();
    if (!success || received != 1) dsc_fail(context, "control-read", success ? ERROR_BROKEN_PIPE : error);
    if (character == '\n') break;
    if (length >= DSC_WIRE_LIMIT - 1 ||
        (character != '\t' && (character < 32 || character > 126)))
      dsc_fail(context, "command-frame", ERROR_INVALID_DATA);
    line[length++] = character;
  }
  line[length] = '\0';
  for (index = 0; index < length; index++) {
    if (line[index] != '\t') continue;
    if (count >= 5) dsc_fail(context, "command-fields", ERROR_INVALID_DATA);
    line[index] = '\0';
    fields[count++] = &line[index + 1];
  }
  if (count != 5 || strcmp(fields[0], "DSCG07/1") != 0 ||
      strcmp(fields[2], context->run) != 0 || !dsc_hex(fields[4]))
    dsc_fail(context, "command-identity", ERROR_INVALID_DATA);
}

static void dsc_write_markers(dsc_context *context) {
  DWORD output_type;
  DWORD error_type;
  DWORD out_bytes = 0;
  DWORD err_bytes = 0;
  DWORD out_error;
  DWORD err_error;
  BOOL out_success;
  BOOL err_success;
  char marker[DSC_MARKER_BYTES + 1];
  char suffix[128];
  int length;
  if (!context->output || !context->error_output || context->output == INVALID_HANDLE_VALUE ||
      context->error_output == INVALID_HANDLE_VALUE || context->output == context->error_output)
    dsc_fail(context, "stdio-owner", ERROR_INVALID_HANDLE);
  output_type = GetFileType(context->output);
  if (output_type != FILE_TYPE_PIPE) dsc_fail(context, "stdout-type", output_type == FILE_TYPE_UNKNOWN ? GetLastError() : ERROR_INVALID_HANDLE);
  error_type = GetFileType(context->error_output);
  if (error_type != FILE_TYPE_PIPE) dsc_fail(context, "stderr-type", error_type == FILE_TYPE_UNKNOWN ? GetLastError() : ERROR_INVALID_HANDLE);
  length = snprintf(marker, sizeof(marker), "stdout:%s\n", context->run);
  if (length != DSC_MARKER_BYTES) dsc_fail(context, "stdout-marker", ERROR_INVALID_DATA);
  out_success = WriteFile(context->output, marker, DSC_MARKER_BYTES, &out_bytes, NULL);
  out_error = out_success ? 0 : GetLastError();
  length = snprintf(marker, sizeof(marker), "stderr:%s\n", context->run);
  if (length != DSC_MARKER_BYTES) dsc_fail(context, "stderr-marker", ERROR_INVALID_DATA);
  err_success = WriteFile(context->error_output, marker, DSC_MARKER_BYTES, &err_bytes, NULL);
  err_error = err_success ? 0 : GetLastError();
  length = snprintf(suffix, sizeof(suffix), "%lu\t%lu\t%lu\t%lu\t1", (unsigned long)out_bytes,
    (unsigned long)err_bytes, (unsigned long)output_type, (unsigned long)error_type);
  if (length <= 0 || (size_t)length >= sizeof(suffix)) dsc_fail(context, "written-record", ERROR_INVALID_DATA);
  dsc_emit(context, "WRITTEN", suffix);
  if (!out_success) dsc_fail(context, "stdout-write", out_error);
  if (!err_success) dsc_fail(context, "stderr-write", err_error);
  if (out_bytes != DSC_MARKER_BYTES || err_bytes != DSC_MARKER_BYTES)
    dsc_fail(context, "marker-short-write", ERROR_WRITE_FAULT);
}

static void dsc_close_stdio(dsc_context *context) {
  HANDLE output = context->output;
  HANDLE error_output = context->error_output;
  BOOL out_set;
  BOOL out_close;
  BOOL err_set;
  BOOL err_close;
  DWORD out_set_error;
  DWORD out_close_error;
  DWORD err_set_error;
  DWORD err_close_error;
  char suffix[160];
  int length;
  // Only these two inherited owners are closed; stale CRT fd slots are never used.
  context->output = INVALID_HANDLE_VALUE;
  context->error_output = INVALID_HANDLE_VALUE;
  out_set = SetStdHandle(STD_OUTPUT_HANDLE, NULL);
  out_set_error = out_set ? 0 : GetLastError();
  out_close = CloseHandle(output);
  out_close_error = out_close ? 0 : GetLastError();
  err_set = SetStdHandle(STD_ERROR_HANDLE, NULL);
  err_set_error = err_set ? 0 : GetLastError();
  err_close = CloseHandle(error_output);
  err_close_error = err_close ? 0 : GetLastError();
  length = snprintf(suffix, sizeof(suffix), "%d\t%lu\t%d\t%lu\t%d\t%lu\t%d\t%lu",
    !!out_set, (unsigned long)out_set_error, !!out_close, (unsigned long)out_close_error,
    !!err_set, (unsigned long)err_set_error, !!err_close, (unsigned long)err_close_error);
  if (length <= 0 || (size_t)length >= sizeof(suffix)) dsc_fail(context, "closed-record", ERROR_INVALID_DATA);
  dsc_emit(context, "CLOSED", suffix);
  if (!out_set) dsc_fail(context, "stdout-set", out_set_error);
  if (!out_close) dsc_fail(context, "stdout-close", out_close_error);
  if (!err_set) dsc_fail(context, "stderr-set", err_set_error);
  if (!err_close) dsc_fail(context, "stderr-close", err_close_error);
}

int wmain(int argc, wchar_t **argv) {
  const wchar_t *pipe_name = NULL;
  const wchar_t *run = NULL;
  const wchar_t *mode = NULL;
  const wchar_t *prefix = L"\\\\.\\pipe\\dsc-g07-";
  dsc_context context;
  HANDLE watchdog;
  int argument;
  int phase = 0;
  char first_token[DSC_RUN_LENGTH + 1] = {0};
  char second_token[DSC_RUN_LENGTH + 1] = {0};
  context.deadline = GetTickCount64() + DSC_TTL_MS;
  context.control = INVALID_HANDLE_VALUE;
  context.output = GetStdHandle(STD_OUTPUT_HANDLE);
  context.error_output = GetStdHandle(STD_ERROR_HANDLE);
  context.pid = GetCurrentProcessId();
  context.sequence = 0;
  context.last_ticks = 0;
  if (argc != 7) ExitProcess(64);
  for (argument = 1; argument < argc; argument += 2) {
    if (wcscmp(argv[argument], L"--pipe") == 0 && !pipe_name) pipe_name = argv[argument + 1];
    else if (wcscmp(argv[argument], L"--run") == 0 && !run) run = argv[argument + 1];
    else if (wcscmp(argv[argument], L"--mode") == 0 && !mode) mode = argv[argument + 1];
    else ExitProcess(64);
  }
  if (!pipe_name || !run || !mode || !dsc_wide_hex(run, context.run) ||
      wcsncmp(pipe_name, prefix, wcslen(prefix)) != 0 || !dsc_wide_hex(pipe_name + wcslen(prefix), NULL))
    ExitProcess(64);
  if (wcscmp(mode, L"close-wait") == 0) context.mode = "close-wait";
  else if (wcscmp(mode, L"keep-open") == 0) context.mode = "keep-open";
  else if (wcscmp(mode, L"close-exit") == 0) context.mode = "close-exit";
  else ExitProcess(64);
  if (!QueryPerformanceFrequency(&context.frequency) || context.frequency.QuadPart <= 0) ExitProcess(71);
  watchdog = CreateThread(NULL, 0, dsc_watchdog, &context, 0, NULL);
  if (!watchdog) ExitProcess(72);
  if (!CloseHandle(watchdog)) ExitProcess(73);
  // The independent watchdog bounds synchronous control reads and writes.
  context.control = CreateFileW(pipe_name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
    SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);
  if (context.control == INVALID_HANDLE_VALUE) ExitProcess(75);
  dsc_emit(&context, "HELLO", context.mode);
  dsc_write_markers(&context);
  if (strcmp(context.mode, "keep-open") != 0) {
    dsc_close_stdio(&context);
    if (strcmp(context.mode, "close-exit") == 0) ExitProcess(0);
  }
  for (;;) {
    char line[DSC_WIRE_LIMIT];
    char *fields[5];
    char suffix[64];
    int length;
    dsc_read_command(&context, line, fields);
    if (strcmp(context.mode, "keep-open") == 0) dsc_fail(&context, "keep-open-command", ERROR_INVALID_DATA);
    if (strcmp(fields[1], "PING") == 0) {
      if (phase == 0 && strcmp(fields[3], "1") == 0) {
        dsc_copy_token(first_token, fields[4]);
        phase = 1;
      } else if (phase == 1 && strcmp(fields[3], "2") == 0 && strcmp(fields[4], first_token) != 0) {
        dsc_copy_token(second_token, fields[4]);
        phase = 2;
      } else dsc_fail(&context, "challenge-order", ERROR_INVALID_DATA);
      length = snprintf(suffix, sizeof(suffix), "%d\t%s", phase, fields[4]);
      if (length <= 0 || (size_t)length >= sizeof(suffix)) dsc_fail(&context, "pong-record", ERROR_INVALID_DATA);
      dsc_emit(&context, "PONG", suffix);
    } else if (strcmp(fields[1], "EXIT") == 0) {
      if (phase != 2 || strcmp(fields[3], "2") != 0 || strcmp(fields[4], second_token) != 0)
        dsc_fail(&context, "exit-permission", ERROR_INVALID_DATA);
      length = snprintf(suffix, sizeof(suffix), "2\t%s", second_token);
      if (length <= 0 || (size_t)length >= sizeof(suffix)) dsc_fail(&context, "exiting-record", ERROR_INVALID_DATA);
      dsc_emit(&context, "EXITING", suffix);
      ExitProcess(0);
    } else dsc_fail(&context, "command-type", ERROR_INVALID_DATA);
  }
}
