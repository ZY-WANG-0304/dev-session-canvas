#ifndef _WIN32
#define _DEFAULT_SOURCE
#endif
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <tlhelp32.h>
#elif defined(__APPLE__)
#include <libproc.h>
#include <sys/proc_info.h>
#include <unistd.h>
#else
#include <dirent.h>
#include <unistd.h>
#endif

static void number(napi_env env, napi_value object, const char *key, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  napi_set_named_property(env, object, key, result);
}
static void string(napi_env env, napi_value object, const char *key, const char *value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  napi_set_named_property(env, object, key, result);
}
static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, "RESOURCE_OBSERVER", message);
  return NULL;
}
static void descriptor(napi_env env, napi_value array, uint32_t index, int fd, const char *type, const char *target) {
  napi_value item;
  napi_create_object(env, &item);
  number(env, item, "fd", fd);
  string(env, item, "type", type);
  string(env, item, "target", target);
  napi_set_element(env, array, index, item);
}
static napi_value observe(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result, descriptors;
  napi_create_object(env, &result);
  napi_create_array(env, &descriptors);
  uint32_t count = 0, threads = 0;
#ifdef _WIN32
  DWORD pid = GetCurrentProcessId(), handles = 0;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return fail(env, "CreateToolhelp32Snapshot failed");
  THREADENTRY32 entry;
  memset(&entry, 0, sizeof(entry));
  entry.dwSize = (DWORD)sizeof(entry);
  if (!Thread32First(snapshot, &entry)) { CloseHandle(snapshot); return fail(env, "Thread32First failed"); }
  do { if (entry.th32OwnerProcessID == pid) threads++; } while (Thread32Next(snapshot, &entry));
  DWORD last = GetLastError();
  if (!CloseHandle(snapshot)) return fail(env, "CloseHandle snapshot failed");
  if (last != ERROR_NO_MORE_FILES) return fail(env, "Thread32Next failed");
  if (!GetProcessHandleCount(GetCurrentProcess(), &handles)) return fail(env, "GetProcessHandleCount failed");
  number(env, result, "handles", handles);
  number(env, result, "pid", pid);
  (void)count;
  (void)descriptor;
#elif defined(__APPLE__)
  int pid = getpid();
  struct proc_taskinfo task;
  if (proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &task, (int)sizeof(task)) != (int)sizeof(task)) return fail(env, "PROC_PIDTASKINFO failed");
  threads = task.pti_threadnum;
  int size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
  if (size <= 0) return fail(env, "PROC_PIDLISTFDS sizing failed");
  size += 64 * (int)sizeof(struct proc_fdinfo);
  struct proc_fdinfo *fds = malloc((size_t)size);
  if (!fds) return fail(env, "fd allocation failed");
  int used = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, size);
  if (used <= 0 || used >= size || used % (int)sizeof(struct proc_fdinfo)) { free(fds); return fail(env, "PROC_PIDLISTFDS incomplete"); }
  for (int i = 0; i < used / (int)sizeof(struct proc_fdinfo); i++) {
    char type[32];
    if (fds[i].proc_fdtype == PROX_FDTYPE_KQUEUE) snprintf(type, sizeof(type), "kqueue");
    else snprintf(type, sizeof(type), "type-%u", fds[i].proc_fdtype);
    descriptor(env, descriptors, count++, fds[i].proc_fd, type, "");
  }
  free(fds);
  number(env, result, "fds", count);
  number(env, result, "pid", pid);
#else
  DIR *directory = opendir("/proc/self/fd");
  if (!directory) return fail(env, "fd opendir failed");
  int own = dirfd(directory);
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    char *end;
    long fd = strtol(entry->d_name, &end, 10);
    if (*end || entry->d_name == end || fd == own) continue;
    char file[128], target[4096];
    snprintf(file, sizeof(file), "/proc/self/fd/%ld", fd);
    ssize_t length = readlink(file, target, sizeof(target) - 1);
    if (length < 0) { closedir(directory); return fail(env, "fd readlink failed"); }
    target[length] = 0;
    const char *type = strstr(target, "eventpoll") ? "eventpoll" : strstr(target, "eventfd") ? "eventfd" :
      strstr(target, "pipe:[") ? "pipe" : strstr(target, "socket:[") ? "socket" : "other";
    descriptor(env, descriptors, count++, (int)fd, type, target);
  }
  if (closedir(directory)) return fail(env, "fd closedir failed");
  directory = opendir("/proc/self/task");
  if (!directory) return fail(env, "task opendir failed");
  while ((entry = readdir(directory))) if (entry->d_name[0] != '.') threads++;
  if (closedir(directory)) return fail(env, "task closedir failed");
  number(env, result, "fds", count);
  number(env, result, "pid", getpid());
#endif
  number(env, result, "threads", threads);
  napi_set_named_property(env, result, "descriptors", descriptors);
  return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "observe", NAPI_AUTO_LENGTH, observe, NULL, &function);
  napi_set_named_property(env, exports, "observe", function);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
