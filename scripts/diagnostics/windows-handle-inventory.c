#include <node_api.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <windows.h>
#include <tlhelp32.h>

/* Query only object types: querying pipe names can wait for unrelated I/O. */
typedef LONG (NTAPI *query_process_fn)(HANDLE, ULONG, PVOID, ULONG, PULONG);
typedef LONG (NTAPI *query_object_fn)(HANDLE, ULONG, PVOID, ULONG, PULONG);
typedef BOOL (WINAPI *query_image_fn)(HANDLE, DWORD, LPWSTR, PDWORD);
typedef struct {
  HANDLE value;
  SIZE_T handle_count, pointer_count;
  ULONG access, type_index, attributes, reserved;
} handle_entry;
typedef struct {
  ULONG_PTR count, reserved;
  handle_entry entries[1];
} handle_table;
typedef struct {
  USHORT length, maximum_length;
  PWSTR buffer;
} type_name;
typedef struct {
  void *memory;
  ULONG capacity, used, attempts;
  LONG status;
  SIZE_T count;
  int valid;
} table_result;

static void number(napi_env env, napi_value object, const char *key, double value) {
  napi_value item;
  napi_create_double(env, value, &item);
  napi_set_named_property(env, object, key, item);
}
static void dsc_boolean(napi_env env, napi_value object, const char *key, int value) {
  napi_value item;
  napi_get_boolean(env, value != 0, &item);
  napi_set_named_property(env, object, key, item);
}
static void string(napi_env env, napi_value object, const char *key, const char *value) {
  napi_value item;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &item);
  napi_set_named_property(env, object, key, item);
}
static void wide(napi_env env, napi_value object, const char *key, const WCHAR *value, size_t length) {
  napi_value item;
  napi_create_string_utf16(env, (const char16_t *)value, length, &item);
  napi_set_named_property(env, object, key, item);
}
static void hex(napi_env env, napi_value object, const char *key, unsigned long long value) {
  char text[32];
  snprintf(text, sizeof(text), "0x%llx", value);
  string(env, object, key, text);
}
static void status(napi_env env, napi_value object, const char *key, LONG value) {
  char text[16];
  snprintf(text, sizeof(text), "0x%08lx", (unsigned long)(ULONG)value);
  string(env, object, key, text);
}
static void error_record(napi_env env, napi_value errors, uint32_t *count,
                         const char *api, const char *reason, DWORD code, HANDLE handle) {
  napi_value item;
  napi_create_object(env, &item);
  string(env, item, "api", api);
  string(env, item, "reason", reason);
  number(env, item, "win32", code);
  hex(env, item, "slot", (unsigned long long)(uintptr_t)handle);
  napi_set_element(env, errors, (*count)++, item);
}
static int compare_entry(const void *a, const void *b) {
  uintptr_t left = (uintptr_t)((const handle_entry *)a)->value;
  uintptr_t right = (uintptr_t)((const handle_entry *)b)->value;
  return left < right ? -1 : left > right;
}
static table_result snapshot(query_process_fn query) {
  table_result result;
  ULONG capacity = 65536;
  memset(&result, 0, sizeof(result));
  result.status = (LONG)0xc0000002UL;
  if (!query) return result;
  while (result.attempts < 8 && capacity <= 16UL * 1024UL * 1024UL) {
    handle_table *table;
    ULONG returned = 0;
    free(result.memory);
    result.memory = calloc(1, capacity);
    result.capacity = capacity;
    result.attempts++;
    if (!result.memory) { result.status = (LONG)0xc0000017UL; return result; }
    result.status = query(GetCurrentProcess(), 51, result.memory, capacity, &returned);
    result.used = returned;
    if (result.status >= 0) {
      SIZE_T offset = offsetof(handle_table, entries);
      table = (handle_table *)result.memory;
      if (returned < offset || returned > capacity ||
          table->count > (returned - offset) / sizeof(handle_entry)) return result;
      result.count = (SIZE_T)table->count;
      qsort(table->entries, result.count, sizeof(handle_entry), compare_entry);
      result.valid = 1;
      return result;
    }
    if ((ULONG)result.status != 0xc0000004UL && (ULONG)result.status != 0xc0000023UL &&
        (ULONG)result.status != 0x80000005UL) return result;
    capacity = returned > capacity && returned <= 16UL * 1024UL * 1024UL ? returned : capacity * 2;
  }
  return result;
}
static void process_details(napi_env env, napi_value item, HANDLE handle, query_image_fn image,
                             napi_value errors, uint32_t *error_count) {
  napi_value process;
  DWORD pid, code, last, image_size = 32768;
  FILETIME creation, exit_time, kernel, user;
  WCHAR *image_path;
  napi_create_object(env, &process);
  pid = GetProcessId(handle);
  last = GetLastError();
  number(env, process, "pid", pid);
  if (!pid) error_record(env, errors, error_count, "GetProcessId", "query-failed", last, handle);
  if (GetProcessTimes(handle, &creation, &exit_time, &kernel, &user)) {
    unsigned long long time = ((unsigned long long)creation.dwHighDateTime << 32) | creation.dwLowDateTime;
    hex(env, process, "creationTime", time);
  } else error_record(env, errors, error_count, "GetProcessTimes", "query-failed", GetLastError(), handle);
  if (GetExitCodeProcess(handle, &code)) number(env, process, "exitCode", code);
  else error_record(env, errors, error_count, "GetExitCodeProcess", "query-failed", GetLastError(), handle);
  dsc_boolean(env, process, "imageApiAvailable", image != NULL);
  if (image) {
    image_path = (WCHAR *)calloc(image_size, sizeof(WCHAR));
    if (!image_path) error_record(env, errors, error_count, "QueryFullProcessImageNameW", "allocation-failed", ERROR_NOT_ENOUGH_MEMORY, handle);
    else {
      if (image(handle, 0, image_path, &image_size)) wide(env, process, "image", image_path, image_size);
      else error_record(env, errors, error_count, "QueryFullProcessImageNameW", "query-failed", GetLastError(), handle);
      free(image_path);
    }
  }
  napi_set_named_property(env, item, "process", process);
}
static void query_type(napi_env env, napi_value item, HANDLE handle, query_object_fn query,
                        query_image_fn image, napi_value errors, uint32_t *error_count) {
  void *buffer = NULL;
  ULONG capacity = 1024, returned = 0, attempts = 0;
  LONG result = (LONG)0xc0000002UL;
  int valid = 0;
  while (query && attempts < 8 && capacity <= 65536) {
    free(buffer);
    buffer = calloc(1, capacity);
    attempts++;
    if (!buffer) { result = (LONG)0xc0000017UL; break; }
    returned = 0;
    result = query(handle, 2, buffer, capacity, &returned);
    if (result >= 0) {
      const type_name *name = (const type_name *)buffer;
      uintptr_t start = (uintptr_t)buffer, end = start + returned, address = (uintptr_t)name->buffer;
      if (returned >= sizeof(type_name) && returned <= capacity && name->length % sizeof(WCHAR) == 0 &&
          name->maximum_length % sizeof(WCHAR) == 0 && name->length <= name->maximum_length &&
          name->length > 0 && address >= start + sizeof(type_name) && address <= end && name->length <= end - address) {
        wide(env, item, "type", name->buffer, name->length / sizeof(WCHAR));
        valid = 1;
        if (name->length == 7 * sizeof(WCHAR) && !wmemcmp(name->buffer, L"Process", 7))
          process_details(env, item, handle, image, errors, error_count);
        if (name->length == 4 * sizeof(WCHAR) && !wmemcmp(name->buffer, L"File", 4)) {
          DWORD file_type, last;
          SetLastError(ERROR_SUCCESS);
          file_type = GetFileType(handle); last = GetLastError();
          number(env, item, "fileType", file_type);
          if (file_type == FILE_TYPE_UNKNOWN && last != ERROR_SUCCESS)
            error_record(env, errors, error_count, "GetFileType", "query-failed", last, handle);
        }
      }
      break;
    }
    if ((ULONG)result != 0xc0000004UL && (ULONG)result != 0xc0000023UL && (ULONG)result != 0x80000005UL) break;
    capacity = returned > capacity && returned <= 65536 ? returned : capacity * 2;
  }
  status(env, item, "typeStatus", result);
  number(env, item, "typeAttempts", attempts);
  number(env, item, "typeReturnedBytes", returned);
  dsc_boolean(env, item, "typeValid", valid);
  if (!valid) error_record(env, errors, error_count, "NtQueryObject(2)", "status-or-shape", 0, handle);
  free(buffer);
}
static napi_value table_json(napi_env env, const table_result *result, query_object_fn query,
                             query_image_fn image, napi_value errors, uint32_t *error_count, int types) {
  napi_value object, entries;
  const handle_table *table = (const handle_table *)result->memory;
  SIZE_T i;
  napi_create_object(env, &object);
  napi_create_array(env, &entries);
  status(env, object, "status", result->status);
  dsc_boolean(env, object, "valid", result->valid);
  number(env, object, "capacity", result->capacity);
  number(env, object, "returnedBytes", result->used);
  number(env, object, "attempts", result->attempts);
  number(env, object, "count", (double)result->count);
  for (i = 0; result->valid && i < result->count; i++) {
    const handle_entry *entry = &table->entries[i];
    napi_value item;
    napi_create_object(env, &item);
    hex(env, item, "slot", (unsigned long long)(uintptr_t)entry->value);
    number(env, item, "typeIndex", entry->type_index);
    number(env, item, "access", entry->access);
    number(env, item, "attributes", entry->attributes);
    hex(env, item, "handleCount", (unsigned long long)entry->handle_count);
    hex(env, item, "pointerCount", (unsigned long long)entry->pointer_count);
    if (types) query_type(env, item, entry->value, query, image, errors, error_count);
    napi_set_element(env, entries, (uint32_t)i, item);
  }
  napi_set_named_property(env, object, "entries", entries);
  return object;
}
static int same_table(const table_result *a, const table_result *b) {
  const handle_table *left = (const handle_table *)a->memory, *right = (const handle_table *)b->memory;
  SIZE_T i;
  if (!a->valid || !b->valid || a->count != b->count) return 0;
  for (i = 0; i < a->count; i++) {
    const handle_entry *x = &left->entries[i], *y = &right->entries[i];
    if (x->value != y->value || x->type_index != y->type_index || x->access != y->access || x->attributes != y->attributes) return 0;
  }
  return 1;
}
static napi_value observe(napi_env env, napi_callback_info info) {
  napi_value result, inventory, errors, before_json, after_json, descriptors;
  uint32_t error_count = 0;
  DWORD pid = GetCurrentProcessId(), handles_before = 0, handles_after = 0, threads = 0, last;
  BOOL count_before_ok, count_after_ok;
  HANDLE thread_snapshot;
  THREADENTRY32 thread;
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll"), kernel = GetModuleHandleW(L"kernel32.dll");
  union { FARPROC address; query_process_fn function; } process_query;
  union { FARPROC address; query_object_fn function; } object_query;
  union { FARPROC address; query_image_fn function; } image_query;
  table_result before, after;
  int race;
  (void)info;
  process_query.address = ntdll ? GetProcAddress(ntdll, "NtQueryInformationProcess") : NULL;
  object_query.address = ntdll ? GetProcAddress(ntdll, "NtQueryObject") : NULL;
  image_query.address = kernel ? GetProcAddress(kernel, "QueryFullProcessImageNameW") : NULL;
  napi_create_object(env, &result); napi_create_object(env, &inventory); napi_create_array(env, &errors);
  thread_snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (thread_snapshot == INVALID_HANDLE_VALUE)
    error_record(env, errors, &error_count, "CreateToolhelp32Snapshot", "query-failed", GetLastError(), NULL);
  else {
    memset(&thread, 0, sizeof(thread)); thread.dwSize = (DWORD)sizeof(thread);
    if (!Thread32First(thread_snapshot, &thread))
      error_record(env, errors, &error_count, "Thread32First", "query-failed", GetLastError(), NULL);
    else {
      do { if (thread.th32OwnerProcessID == pid) threads++; } while (Thread32Next(thread_snapshot, &thread));
      last = GetLastError();
      if (last != ERROR_NO_MORE_FILES) error_record(env, errors, &error_count, "Thread32Next", "query-failed", last, NULL);
    }
    if (!CloseHandle(thread_snapshot)) error_record(env, errors, &error_count, "CloseHandle(own-snapshot)", "close-failed", GetLastError(), NULL);
  }
  count_before_ok = GetProcessHandleCount(GetCurrentProcess(), &handles_before);
  if (!count_before_ok) error_record(env, errors, &error_count, "GetProcessHandleCount(before)", "query-failed", GetLastError(), NULL);
  before = snapshot(process_query.function);
  before_json = table_json(env, &before, object_query.function, image_query.function, errors, &error_count, 1);
  after = snapshot(process_query.function);
  after_json = table_json(env, &after, object_query.function, image_query.function, errors, &error_count, 0);
  count_after_ok = GetProcessHandleCount(GetCurrentProcess(), &handles_after);
  if (!count_after_ok) error_record(env, errors, &error_count, "GetProcessHandleCount(after)", "query-failed", GetLastError(), NULL);
  if (!before.valid || !after.valid) error_record(env, errors, &error_count, "NtQueryInformationProcess(51)", "status-or-shape", 0, NULL);
  race = !same_table(&before, &after) || handles_before != handles_after ||
    (SIZE_T)handles_before != before.count || (SIZE_T)handles_after != after.count;
  number(env, result, "pid", pid); number(env, result, "threads", threads);
  number(env, result, "handles", count_after_ok ? (double)handles_after : -1);
  number(env, inventory, "schema", 1);
  number(env, inventory, "handleCountBefore", handles_before); number(env, inventory, "handleCountAfter", handles_after);
  dsc_boolean(env, inventory, "countBeforeValid", count_before_ok); dsc_boolean(env, inventory, "countAfterValid", count_after_ok);
  dsc_boolean(env, inventory, "observerRace", race);
  dsc_boolean(env, inventory, "valid", !race && error_count == 0 && count_before_ok && count_after_ok);
  napi_set_named_property(env, inventory, "before", before_json); napi_set_named_property(env, inventory, "after", after_json);
  napi_set_named_property(env, inventory, "errors", errors);
  napi_get_named_property(env, before_json, "entries", &descriptors);
  napi_set_named_property(env, result, "descriptors", descriptors); napi_set_named_property(env, result, "inventory", inventory);
  free(before.memory); free(after.memory);
  return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "observe", NAPI_AUTO_LENGTH, observe, NULL, &function);
  napi_set_named_property(env, exports, "observe", function);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
