#ifndef DSC_MACOS_NATIVE_FAILURE_SUPPORT_V1_H
#define DSC_MACOS_NATIVE_FAILURE_SUPPORT_V1_H
#if !defined(__APPLE__)
#error "This diagnostic candidate supports macOS only"
#endif

#include <napi.h>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <mutex>
#include <new>
#include <spawn.h>
#include <stdlib.h>
#include <string>
#include <sys/event.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <system_error>
#include <thread>
#include <time.h>
#include <unistd.h>

namespace dsc_macos {

struct Event {
  uint32_t ord = 0;
  uint64_t monoNs = 0;
  char name[48] = {};
  int64_t value = 0;
  int error = 0;
  int64_t aux = 0;
};
struct Resource {
  char id[24] = {};
  int value = -1;
  bool acquired = false, releaseReturned = false;
  int releaseCalls = 0, releaseResult = -1, releaseError = 0;
};
struct Ledger {
  char token[33] = {};
  std::string helperPath, executablePath;
  pid_t pid = -1;
  int master = -1, kqueueFd = -1;
  bool configured = false, spawnAttempted = false, creationFailed = false;
  bool waitConfirmed = false, masterAcquired = false, masterCloseReturned = false;
  bool kqueueAcquired = false, kqueueOwnerRegistered = false, kqueueRegistered = false, kqueueWaitReturned = false;
  bool registerApiEntered = false, registrationCallInvoked = false, registrationFailureInjected = false;
  bool registrationInFlight = false;
  int registrationResult = 0, registrationError = 0;
  pid_t waitPid = -1;
  int waitpidCalls = 0, waitStatus = -1;
  char waitThreadId[32] = "wait-thread-1";
  bool kqueueCloseReturned = false, kqueueExitEventValid = false;
  int kqueueCloseCalls = 0, kqueueCloseError = 0;
  uint64_t kqueueEventIdent = 0;
  int kqueueEventFilter = 0, kqueueEventFlags = 0;
  uint32_t kqueueEventFflags = 0;
  bool threadStarted = false, threadFinished = false, threadJoined = false;
  bool threadConstructCalled = false, threadConstructReturned = false, threadStartFailed = false;
  int threadStartError = 0;
  bool tsfnCreated = false, tsfnFinalized = false, notificationCallInvoked = false;
  bool payloadAllocated = false, payloadFreed = false, nonblockCalled = false;
  bool masterStatValid = false;
  int exitCode = 0, signalCode = 0, waitError = 0;
  int masterCloseCalls = 0, masterCloseError = 0;
  int nonblockResult = 0, nonblockError = 0;
  int tsfnCreateStatus = -1, tsfnReleaseStatus = -1, notificationStatus = -1;
  int notificationCallbackStatus = -1, threadJoinError = 0, clockError = 0;
  int masterFlagsBefore = -1, masterFlagsAfter = -1;
  uint64_t masterStatDev = 0, masterStatIno = 0, masterStatRdev = 0;
  Resource resources[6];
  uint32_t resourceCount = 0, eventCount = 0, nextOrdinal = 0;
  bool overflow = false;
  Event events[256];
};

static Ledger ledger;
static std::mutex ledgerMutex;
static std::thread waiter;

static void RecordLocked(const char* name, int64_t value = 0, int error = 0, int64_t aux = 0) {
  const uint32_t ordinal = ++ledger.nextOrdinal;
  if (ledger.eventCount == 256) { ledger.overflow = true; return; }
  Event& event = ledger.events[ledger.eventCount++];
  event.ord = ordinal;
  struct timespec now = {};
  if (clock_gettime(CLOCK_MONOTONIC, &now) == 0)
    event.monoNs = static_cast<uint64_t>(now.tv_sec) * 1000000000ULL + now.tv_nsec;
  else ledger.clockError = errno;
  std::snprintf(event.name, sizeof(event.name), "%s", name);
  event.value = value; event.error = error; event.aux = aux;
}
static void Record(const char* name, int64_t value = 0, int error = 0, int64_t aux = 0) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  RecordLocked(name, value, error, aux);
}
static void ResourceEnter(const char* id, bool release, int value = 0) {
  char name[48]; std::snprintf(name, sizeof(name), "%s-%s-enter", id, release ? "release" : "acquire");
  Record(name, value);
}
static void ResourceAcquired(const char* id, int value, int error, bool acquired) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (acquired && ledger.resourceCount < 6) {
    Resource& resource = ledger.resources[ledger.resourceCount++];
    std::snprintf(resource.id, sizeof(resource.id), "%s", id);
    resource.value = value; resource.acquired = true;
  } else if (acquired) ledger.overflow = true;
  else ledger.creationFailed = true;
  char name[48]; std::snprintf(name, sizeof(name), "%s-acquire-return", id);
  RecordLocked(name, value, error);
}
static void ResourceReleased(const char* id, int result, int error) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  int value = -1;
  for (uint32_t i = 0; i < ledger.resourceCount; ++i) {
    Resource& resource = ledger.resources[i];
    if (std::strcmp(resource.id, id) != 0) continue;
    value = resource.value; ++resource.releaseCalls;
    resource.releaseReturned = result == 0;
    resource.releaseResult = result; resource.releaseError = error;
  }
  char name[48]; std::snprintf(name, sizeof(name), "%s-release-return", id);
  RecordLocked(name, result, error, value);
}
static int OpenLowFd(size_t index) {
  char id[24]; std::snprintf(id, sizeof(id), "low-fd-%zu", index);
  ResourceEnter(id, false);
  errno = 0; const int result = posix_openpt(O_RDWR); const int error = result < 0 ? errno : 0;
  ResourceAcquired(id, result, error, result >= 0); errno = error; return result;
}
static int OpenSlave(const char* path, int flags) {
  ResourceEnter("slave", false);
  errno = 0; const int result = open(path, flags); const int error = result < 0 ? errno : 0;
  ResourceAcquired("slave", result, error, result >= 0); errno = error; return result;
}
static int CloseResource(const char* id, int fd) {
  ResourceEnter(id, true, fd);
  errno = 0; const int result = close(fd); const int error = result < 0 ? errno : 0;
  ResourceReleased(id, result, error); errno = error; return result;
}
static int CloseLowFd(size_t index, int fd) {
  char id[24]; std::snprintf(id, sizeof(id), "low-fd-%zu", index);
  return CloseResource(id, fd);
}
static int ActionsInit(posix_spawn_file_actions_t* actions) {
  ResourceEnter("spawn-actions", false);
  const int result = posix_spawn_file_actions_init(actions);
  ResourceAcquired("spawn-actions", result, result, result == 0); return result;
}
static int AttrsInit(posix_spawnattr_t* attrs) {
  ResourceEnter("spawn-attrs", false);
  const int result = posix_spawnattr_init(attrs);
  ResourceAcquired("spawn-attrs", result, result, result == 0); return result;
}
static int ActionsDestroy(posix_spawn_file_actions_t* actions) {
  ResourceEnter("spawn-actions", true);
  const int result = posix_spawn_file_actions_destroy(actions);
  ResourceReleased("spawn-actions", result, result); return result;
}
static int AttrsDestroy(posix_spawnattr_t* attrs) {
  ResourceEnter("spawn-attrs", true);
  const int result = posix_spawnattr_destroy(attrs);
  ResourceReleased("spawn-attrs", result, result); return result;
}
static int OpenMaster() {
  Record("master-open-enter");
  errno = 0; const int result = posix_openpt(O_RDWR); const int error = result < 0 ? errno : 0;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.master = result; ledger.masterAcquired = result >= 0;
    if (result < 0) ledger.creationFailed = true;
    RecordLocked("master-open-return", result, error);
  }
  errno = error; return result;
}
static int Spawn(pid_t* pid, const char* file, const posix_spawn_file_actions_t* actions,
                 const posix_spawnattr_t* attrs, char* const argv[], char* const env[]) {
  Record("spawn-enter");
  const int result = posix_spawn(pid, file, actions, attrs, argv, env);
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (result == 0) ledger.pid = *pid;
  else if (result != EINTR) ledger.creationFailed = true;
  RecordLocked("spawn-return", result, result, result == 0 ? *pid : -1);
  if (result == 0) RecordLocked("owner-registered", *pid, 0, ledger.master);
  return result;
}

static Napi::Object MakeSnapshot(Napi::Env env) {
  Ledger state;
  { std::lock_guard<std::mutex> lock(ledgerMutex); state = ledger; }
  Napi::Object out = Napi::Object::New(env);
  out.Set("token", state.token); out.Set("scenario", "U1-6"); out.Set("platform", "darwin");
  out.Set("helperPath", state.helperPath); out.Set("executablePath", state.executablePath);
  out.Set("nonblockMask", O_NONBLOCK); out.Set("noteExitMask", NOTE_EXIT);
  out.Set("procFilter", EVFILT_PROC); out.Set("eventErrorMask", EV_ERROR);
  out.Set("threadFailureInjected", false); out.Set("notificationFailureInjected", false);
#define DSC_BOOL(field) out.Set(#field, Napi::Boolean::New(env, state.field))
#define DSC_INT(field) out.Set(#field, Napi::Number::New(env, state.field))
#define DSC_STATUS(field) out.Set(#field, state.field < 0 ? env.Null() : Napi::Number::New(env, state.field).As<Napi::Value>())
  DSC_INT(pid); DSC_INT(master); DSC_INT(kqueueFd);
  DSC_BOOL(configured); DSC_BOOL(spawnAttempted); DSC_BOOL(creationFailed);
  DSC_BOOL(waitConfirmed); DSC_BOOL(masterAcquired); DSC_BOOL(masterCloseReturned);
  DSC_BOOL(kqueueAcquired); DSC_BOOL(kqueueOwnerRegistered); DSC_BOOL(kqueueRegistered); DSC_BOOL(kqueueWaitReturned);
  DSC_BOOL(registerApiEntered); DSC_BOOL(registrationCallInvoked); DSC_BOOL(registrationFailureInjected);
  DSC_BOOL(registrationInFlight); DSC_INT(registrationResult); DSC_INT(registrationError);
  DSC_INT(waitPid); DSC_INT(waitpidCalls); DSC_INT(waitStatus); out.Set("waitThreadId", state.waitThreadId);
  DSC_BOOL(kqueueCloseReturned); DSC_BOOL(kqueueExitEventValid);
  DSC_INT(kqueueCloseCalls); DSC_INT(kqueueCloseError);
  DSC_BOOL(threadStarted); DSC_BOOL(threadFinished); DSC_BOOL(threadJoined);
  DSC_BOOL(threadConstructCalled); DSC_BOOL(threadConstructReturned);
  DSC_BOOL(threadStartFailed); DSC_INT(threadStartError);
  out.Set("threadJoinable", Napi::Boolean::New(env, waiter.joinable()));
  DSC_BOOL(tsfnCreated); DSC_BOOL(tsfnFinalized); DSC_BOOL(notificationCallInvoked);
  DSC_BOOL(payloadAllocated); DSC_BOOL(payloadFreed); DSC_BOOL(nonblockCalled);
  DSC_BOOL(masterStatValid); DSC_BOOL(overflow);
  DSC_INT(masterCloseCalls); DSC_INT(masterCloseError); DSC_INT(waitError);
  DSC_INT(nonblockResult); DSC_INT(nonblockError); DSC_INT(threadJoinError); DSC_INT(clockError);
  DSC_INT(masterFlagsBefore); DSC_INT(masterFlagsAfter);
  DSC_STATUS(tsfnCreateStatus); DSC_STATUS(tsfnReleaseStatus); DSC_STATUS(notificationStatus);
  DSC_STATUS(notificationCallbackStatus);
#undef DSC_BOOL
#undef DSC_INT
#undef DSC_STATUS
  out.Set("exitCode", state.waitConfirmed ? Napi::Number::New(env, state.exitCode).As<Napi::Value>() : env.Null());
  out.Set("signalCode", state.waitConfirmed ? Napi::Number::New(env, state.signalCode).As<Napi::Value>() : env.Null());
  out.Set("masterStatDev", std::to_string(state.masterStatDev));
  out.Set("masterStatIno", std::to_string(state.masterStatIno));
  out.Set("masterStatRdev", std::to_string(state.masterStatRdev));
  Napi::Object kevent = Napi::Object::New(env);
  kevent.Set("ident", static_cast<double>(state.kqueueEventIdent));
  kevent.Set("filter", state.kqueueEventFilter); kevent.Set("flags", state.kqueueEventFlags);
  kevent.Set("fflags", state.kqueueEventFflags); out.Set("kqueueExitEvent", kevent);
  Napi::Array resources = Napi::Array::New(env, state.resourceCount);
  for (uint32_t i = 0; i < state.resourceCount; ++i) {
    const Resource& resource = state.resources[i];
    Napi::Object item = Napi::Object::New(env);
    item.Set("id", resource.id); item.Set("value", resource.value); item.Set("acquired", resource.acquired);
    item.Set("releaseCalls", resource.releaseCalls); item.Set("releaseReturned", resource.releaseReturned);
    item.Set("releaseResult", resource.releaseCalls ? Napi::Number::New(env, resource.releaseResult).As<Napi::Value>() : env.Null());
    item.Set("releaseError", resource.releaseError); resources.Set(i, item);
  }
  out.Set("resources", resources);
  Napi::Array events = Napi::Array::New(env, state.eventCount);
  for (uint32_t i = 0; i < state.eventCount; ++i) {
    const Event& event = state.events[i]; Napi::Object item = Napi::Object::New(env);
    item.Set("ord", event.ord); item.Set("monoNs", std::to_string(event.monoNs)); item.Set("name", event.name);
    item.Set("value", static_cast<double>(event.value)); item.Set("error", event.error);
    item.Set("aux", static_cast<double>(event.aux)); events.Set(i, item);
  }
  out.Set("events", events); return out;
}
static Napi::Value Configure(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString())
    throw Napi::TypeError::New(env, "failureConfigure requires token and scenario");
  const std::string token = info[0].As<Napi::String>();
  const std::string scenario = info[1].As<Napi::String>();
  if (token.size() != 32 || token.find_first_not_of("0123456789abcdef") != std::string::npos || scenario != "U1-6")
    throw Napi::TypeError::New(env, "Invalid macOS failure identity");
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (ledger.configured) throw Napi::Error::New(env, "Only one session is allowed per native driver");
  std::memcpy(ledger.token, token.c_str(), 33); ledger.configured = true; RecordLocked("configured");
  return Napi::Boolean::New(env, true);
}
static Napi::Value Snapshot(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) throw Napi::TypeError::New(info.Env(), "failureSnapshot takes no arguments");
  return MakeSnapshot(info.Env());
}
static void BeforeSpawn(Napi::Env env, const std::string& helper, const std::string& executable) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (!ledger.configured || ledger.spawnAttempted)
    throw Napi::Error::New(env, "Configure exactly one native failure spawn before creating resources");
  ledger.spawnAttempted = true; ledger.helperPath = helper; ledger.executablePath = executable;
}
static void NonblockEnter() {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.nonblockCalled = true; RecordLocked("nonblock-enter", ledger.master);
}
static void NonblockReturned(int result, int error) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.nonblockResult = result; ledger.nonblockError = error;
  if (result < 0) ledger.creationFailed = true;
  RecordLocked("nonblock-return", result, error, ledger.master);
}
static bool CloseMasterOwned() {
  int fd;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (!ledger.masterAcquired || ledger.masterCloseCalls != 0) {
      RecordLocked("master-close-rejected", ledger.master); return false;
    }
    fd = ledger.master; ++ledger.masterCloseCalls;
  }
  errno = 0; const int before = fcntl(fd, F_GETFL); const int beforeError = before < 0 ? errno : 0;
  Record("master-fgetfl-before", before, beforeError, fd);
  struct stat stat = {};
  errno = 0; const int statResult = fstat(fd, &stat); const int statError = statResult < 0 ? errno : 0;
  Record("master-fstat", statResult, statError, fd);
  errno = 0; const int after = fcntl(fd, F_GETFL); const int afterError = after < 0 ? errno : 0;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.masterFlagsBefore = before; ledger.masterFlagsAfter = after; ledger.masterStatValid = statResult == 0;
    if (statResult == 0) {
      ledger.masterStatDev = stat.st_dev; ledger.masterStatIno = stat.st_ino; ledger.masterStatRdev = stat.st_rdev;
    }
    RecordLocked("master-fgetfl-after", after, afterError, fd); RecordLocked("master-close-enter", fd);
  }
  errno = 0; const int result = close(fd); const int error = result < 0 ? errno : 0;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.masterCloseReturned = result == 0; ledger.masterCloseError = error;
    RecordLocked("master-close-return", result, error, fd);
  }
  return true;
}
static Napi::Value CloseMaster(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsString())
    throw Napi::TypeError::New(info.Env(), "failureCloseMaster requires the configured token");
  const std::string token = info[0].As<Napi::String>();
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (!ledger.configured || token != ledger.token) throw Napi::Error::New(info.Env(), "Foreign master owner token");
  }
  if (!CloseMasterOwned()) throw Napi::Error::New(info.Env(), "Master is not owned or close was already attempted");
  return MakeSnapshot(info.Env());
}

struct ExitPayload { int code; int signal; };
struct PayloadDeleter {
  void operator()(ExitPayload* payload) const {
    if (!payload) return;
    delete payload;
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.payloadFreed = true; RecordLocked("payload-freed");
  }
};
static void Notify(napi_env env, napi_value callback, void*, void* data) {
  std::unique_ptr<ExitPayload, PayloadDeleter> payload(static_cast<ExitPayload*>(data));
  if (!env || !callback) { Record("notification-env-unavailable"); return; }
  napi_value receiver, args[2];
  napi_status status = napi_get_undefined(env, &receiver);
  if (status == napi_ok) status = napi_create_int32(env, payload->code, &args[0]);
  if (status == napi_ok) status = napi_create_int32(env, payload->signal, &args[1]);
  if (status == napi_ok) status = napi_call_function(env, receiver, callback, 2, args, nullptr);
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.notificationCallbackStatus = status; RecordLocked("notification-callback", status);
}
static void Finalize(napi_env, void*, void*) {
  Record("tsfn-finalizer-enter");
  try {
    // The worker records its final state under the ledger lock; join outside it.
    if (waiter.joinable()) {
      waiter.join();
      std::lock_guard<std::mutex> lock(ledgerMutex);
      ledger.threadJoined = true; RecordLocked("thread-joined");
    } else Record("thread-not-joinable");
  } catch (const std::system_error& error) {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.threadJoinError = error.code().value(); RecordLocked("thread-join-error", -1, ledger.threadJoinError);
  }
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.tsfnFinalized = true; RecordLocked("tsfn-finalized");
}
static void Release(napi_threadsafe_function tsfn) {
  Record("tsfn-release-enter");
  const napi_status status = napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.tsfnReleaseStatus = status; RecordLocked("tsfn-release-return", status);
}
static void Wait(napi_threadsafe_function tsfn, pid_t pid) {
  { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.threadStarted = true; RecordLocked("thread-started", pid); }
  int kq = -1, result = -1, error = 0;
  do {
    Record("kqueue-enter"); errno = 0; kq = kqueue(); error = kq < 0 ? errno : 0;
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (kq >= 0) { ledger.kqueueFd = kq; ledger.kqueueAcquired = true; ledger.kqueueOwnerRegistered = true; }
    RecordLocked("kqueue-return", kq, error);
  } while (kq == -1 && error == EINTR);

  // U1-6 substitutes the registration result only after kqueue ownership is recorded.
  if (kq >= 0) {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.registerApiEntered = true; ledger.registrationFailureInjected = true;
    ledger.registrationCallInvoked = false; ledger.registrationInFlight = false;
    ledger.registrationResult = -1; ledger.registrationError = EIO;
    RecordLocked("kqueue-register-enter", kq, 0, pid);
    RecordLocked("kqueue-register-failure", -1, EIO, kq);
  }

  int status = 0, code = 0, signal = 0;
  bool decoded = false;
  if (kq >= 0) {
    pid_t waited;
    do {
      { std::lock_guard<std::mutex> lock(ledgerMutex); ++ledger.waitpidCalls; RecordLocked("wait-enter", pid); }
      errno = 0; waited = waitpid(pid, &status, 0); error = waited < 0 ? errno : 0;
      { std::lock_guard<std::mutex> lock(ledgerMutex);
        RecordLocked("wait-return", waited, error, waited == pid ? status : 0); }
    } while (waited == -1 && error == EINTR);
    decoded = waited == pid && (WIFEXITED(status) || WIFSIGNALED(status));
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.waitPid = waited; ledger.waitStatus = decoded ? status : -1;
    ledger.waitError = error; ledger.waitConfirmed = decoded;
    if (decoded) {
      code = WIFEXITED(status) ? WEXITSTATUS(status) : 0;
      signal = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
      ledger.exitCode = code; ledger.signalCode = signal;
    }
  }
  if (kq >= 0) {
    { std::lock_guard<std::mutex> lock(ledgerMutex); ++ledger.kqueueCloseCalls; RecordLocked("kqueue-close-enter", kq); }
    errno = 0; result = close(kq); error = result < 0 ? errno : 0;
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.kqueueCloseReturned = result == 0; ledger.kqueueCloseError = error;
    RecordLocked("kqueue-close-return", result, error, kq);
  }
  napi_status notification = napi_ok;
  if (decoded) {
    std::unique_ptr<ExitPayload, PayloadDeleter> payload(new (std::nothrow) ExitPayload{code, signal});
    if (payload) {
      { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.payloadAllocated = true; RecordLocked("payload-allocated");
        ledger.notificationCallInvoked = true; RecordLocked("notification-enter"); }
      notification = napi_call_threadsafe_function(tsfn, payload.get(), napi_tsfn_blocking);
      if (notification == napi_ok) payload.release();
      { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.notificationStatus = notification; RecordLocked("notification-return", notification); }
    } else Record("payload-allocation-failed", -1, ENOMEM);
  }
  if (notification != napi_closing) Release(tsfn); else Record("tsfn-release-not-attempted", notification);
  { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.threadFinished = true; RecordLocked("thread-finished", pid); }
}
static void SetupExitCallback(Napi::Env env, Napi::Function cb, pid_t pid) {
  napi_value name;
  napi_status status = napi_create_string_utf8(env, "DscMacosBaselineWaiter", NAPI_AUTO_LENGTH, &name);
  if (status != napi_ok) { Record("tsfn-name-error", status); throw Napi::Error::New(env, "Could not create diagnostic TSFN name"); }
  napi_threadsafe_function tsfn = nullptr;
  Record("tsfn-create-enter");
  status = napi_create_threadsafe_function(env, cb, nullptr, name, 0, 1, nullptr, Finalize, nullptr, Notify, &tsfn);
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.tsfnCreateStatus = status; ledger.tsfnCreated = status == napi_ok; RecordLocked("tsfn-create-return", status);
  }
  if (status != napi_ok) throw Napi::Error::New(env, "Could not create diagnostic TSFN");
  try {
    { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.threadConstructCalled = true; RecordLocked("thread-construction-enter", pid); }
    waiter = std::thread(Wait, tsfn, pid);
    { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.threadConstructReturned = true; RecordLocked("thread-construction-return", 0, 0, pid); }
  } catch (const std::system_error& error) {
    {
      std::lock_guard<std::mutex> lock(ledgerMutex);
      ledger.creationFailed = true; ledger.threadStartFailed = true; ledger.threadStartError = error.code().value();
      RecordLocked("thread-start-error", -1, ledger.threadStartError);
    }
    Release(tsfn);
    throw Napi::Error::New(env, "Could not start diagnostic waiter; acquired native resources remain unresolved");
  }
}

}  // namespace dsc_macos
#endif
