#ifndef DSC_UNIX_NATIVE_FAILURE_SUPPORT_V1_H
#define DSC_UNIX_NATIVE_FAILURE_SUPPORT_V1_H
#if !defined(__linux__)
#error "This diagnostic candidate supports Linux only"
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
#include <signal.h>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <thread>
#include <time.h>
#include <unistd.h>

namespace dsc_failure {

struct Event {
  uint32_t ord = 0;
  uint64_t monoNs = 0;
  char name[48] = {};
  int64_t value = 0;
  int error = 0;
  int64_t aux = 0;
};

struct Ledger {
  char token[33] = {};
  char scenario[5] = {};
  pid_t pid = -1;
  int master = -1;
  bool configured = false, forkAttempted = false, creationFailed = false;
  bool waitConfirmed = false, masterAcquired = false, masterCloseReturned = false;
  bool threadStarted = false, threadFinished = false, threadJoined = false;
  bool tsfnCreated = false, tsfnFinalized = false;
  bool payloadAllocated = false, payloadFreed = false, nonblockCalled = false;
  bool controlReturned = false, masterStatValid = false;
  int exitCode = 0, signalCode = 0, waitError = 0;
  int masterCloseCalls = 0, masterCloseError = 0;
  int nonblockResult = 0, nonblockError = 0;
  int controlCalls = 0, controlError = 0;
  int tsfnCreateStatus = -1, tsfnReleaseStatus = -1, notificationStatus = -1;
  int notificationCallbackStatus = -1, threadJoinError = 0, clockError = 0;
  int masterFlagsBefore = -1, masterFlagsAfter = -1;
  uint64_t masterStatDev = 0, masterStatIno = 0, masterStatRdev = 0;
  uint32_t eventCount = 0, nextOrdinal = 0;
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
  struct timespec time = {};
  if (clock_gettime(CLOCK_MONOTONIC, &time) == 0)
    event.monoNs = static_cast<uint64_t>(time.tv_sec) * 1000000000ULL + time.tv_nsec;
  else ledger.clockError = errno;
  std::snprintf(event.name, sizeof(event.name), "%s", name);
  event.value = value; event.error = error; event.aux = aux;
}

static void Record(const char* name, int64_t value = 0, int error = 0, int64_t aux = 0) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  RecordLocked(name, value, error, aux);
}

static Napi::Object MakeSnapshot(Napi::Env env) {
  Ledger state;
  { std::lock_guard<std::mutex> lock(ledgerMutex); state = ledger; }
  Napi::Object out = Napi::Object::New(env);
  out.Set("token", state.token); out.Set("scenario", state.scenario);
#define DSC_BOOL(field) out.Set(#field, Napi::Boolean::New(env, state.field))
#define DSC_INT(field) out.Set(#field, Napi::Number::New(env, state.field))
#define DSC_STATUS(field) out.Set(#field, state.field < 0 ? env.Null() : Napi::Number::New(env, state.field).As<Napi::Value>())
  DSC_INT(pid); DSC_INT(master);
  DSC_BOOL(configured); DSC_BOOL(forkAttempted); DSC_BOOL(creationFailed);
  DSC_BOOL(waitConfirmed); DSC_BOOL(masterAcquired); DSC_BOOL(masterCloseReturned);
  DSC_BOOL(threadStarted); DSC_BOOL(threadFinished); DSC_BOOL(threadJoined);
  DSC_BOOL(tsfnCreated); DSC_BOOL(tsfnFinalized);
  DSC_BOOL(payloadAllocated); DSC_BOOL(payloadFreed); DSC_BOOL(nonblockCalled);
  DSC_BOOL(controlReturned); DSC_BOOL(masterStatValid); DSC_BOOL(overflow);
  DSC_INT(masterCloseCalls); DSC_INT(masterCloseError); DSC_INT(waitError);
  DSC_INT(nonblockResult); DSC_INT(nonblockError); DSC_INT(controlCalls); DSC_INT(controlError);
  DSC_INT(threadJoinError); DSC_INT(clockError); DSC_INT(masterFlagsBefore); DSC_INT(masterFlagsAfter);
  DSC_STATUS(tsfnCreateStatus); DSC_STATUS(tsfnReleaseStatus);
  DSC_STATUS(notificationStatus); DSC_STATUS(notificationCallbackStatus);
#undef DSC_BOOL
#undef DSC_INT
#undef DSC_STATUS
  out.Set("exitCode", state.waitConfirmed ? Napi::Number::New(env, state.exitCode).As<Napi::Value>() : env.Null());
  out.Set("signalCode", state.waitConfirmed ? Napi::Number::New(env, state.signalCode).As<Napi::Value>() : env.Null());
  out.Set("masterStatDev", std::to_string(state.masterStatDev));
  out.Set("masterStatIno", std::to_string(state.masterStatIno));
  out.Set("masterStatRdev", std::to_string(state.masterStatRdev));
  Napi::Array events = Napi::Array::New(env, state.eventCount);
  for (uint32_t i = 0; i < state.eventCount; ++i) {
    const Event& event = state.events[i];
    Napi::Object item = Napi::Object::New(env);
    item.Set("ord", event.ord); item.Set("monoNs", std::to_string(event.monoNs));
    item.Set("name", event.name); item.Set("value", static_cast<double>(event.value));
    item.Set("error", event.error); item.Set("aux", static_cast<double>(event.aux));
    events.Set(i, item);
  }
  out.Set("events", events);
  return out;
}

static Napi::Value Configure(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString())
    throw Napi::TypeError::New(env, "failureConfigure requires token and scenario");
  const std::string token = info[0].As<Napi::String>();
  const std::string scenario = info[1].As<Napi::String>();
  if (token.size() != 32 || token.find_first_not_of("0123456789abcdef") != std::string::npos ||
      (scenario != "U1-0" && scenario != "U1-1"))
    throw Napi::TypeError::New(env, "Invalid native failure identity");
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (ledger.configured) throw Napi::Error::New(env, "Only one session is allowed per native driver");
    std::memcpy(ledger.token, token.c_str(), 33);
    std::memcpy(ledger.scenario, scenario.c_str(), 5);
    ledger.configured = true;
    RecordLocked("configured");
  }
  return Napi::Boolean::New(env, true);
}

static Napi::Value Snapshot(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) throw Napi::TypeError::New(info.Env(), "failureSnapshot takes no arguments");
  return MakeSnapshot(info.Env());
}

static void BeforeFork(Napi::Env env) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (!ledger.configured || ledger.forkAttempted)
    throw Napi::Error::New(env, "Configure exactly one native fork before creating resources");
  ledger.forkAttempted = true;
}

static void ForkEnter() { Record("fork-enter"); }

static void ForkReturned(pid_t pid, int master, int error) {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  // Store ownership before recording or constructing any JavaScript values.
  if (pid > 0) { ledger.pid = pid; ledger.master = master; ledger.masterAcquired = master >= 0; }
  else ledger.creationFailed = true;
  RecordLocked("fork-return", pid, error, master);
  if (pid > 0) RecordLocked("owner-registered", pid, 0, master);
}

static bool InjectNonblockFailure() {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  if (std::strcmp(ledger.scenario, "U1-1") != 0) return false;
  ledger.creationFailed = true; ledger.nonblockResult = -1; ledger.nonblockError = EIO;
  RecordLocked("nonblock-skipped", -1, EIO, ledger.master);
  return true;
}

static bool CreationFailed() {
  std::lock_guard<std::mutex> lock(ledgerMutex);
  return ledger.creationFailed;
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

static void ObserveMaster(int fd) {
  errno = 0; const int before = fcntl(fd, F_GETFL); const int beforeError = before < 0 ? errno : 0;
  Record("master-fgetfl-before", before, beforeError, fd);
  struct stat stat = {};
  errno = 0; const int statResult = fstat(fd, &stat); const int statError = statResult < 0 ? errno : 0;
  Record("master-fstat", statResult, statError, fd);
  errno = 0; const int after = fcntl(fd, F_GETFL); const int afterError = after < 0 ? errno : 0;
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.masterFlagsBefore = before; ledger.masterFlagsAfter = after;
  ledger.masterStatValid = statResult == 0;
  if (statResult == 0) {
    ledger.masterStatDev = stat.st_dev; ledger.masterStatIno = stat.st_ino; ledger.masterStatRdev = stat.st_rdev;
  }
  RecordLocked("master-fgetfl-after", after, afterError, fd);
}

static bool CloseMasterOwned() {
  int fd;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (!ledger.masterAcquired || ledger.masterCloseCalls != 0) {
      RecordLocked("master-close-rejected", ledger.master); return false;
    }
    fd = ledger.master;
  }
  ObserveMaster(fd);
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ++ledger.masterCloseCalls; RecordLocked("master-close-enter", fd);
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
    if (!ledger.configured || token != ledger.token)
      throw Napi::Error::New(info.Env(), "Foreign master owner token");
  }
  if (!CloseMasterOwned()) throw Napi::Error::New(info.Env(), "Master is not owned or close was already attempted");
  return MakeSnapshot(info.Env());
}

static void TerminateBeforeWaiter() {
  pid_t pid;
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    if (!ledger.masterAcquired || ledger.pid <= 0 || ledger.waitConfirmed || ledger.threadStarted || ledger.controlCalls) {
      RecordLocked("control-rejected"); return;
    }
    pid = ledger.pid; ++ledger.controlCalls; RecordLocked("control-enter", pid, 0, SIGTERM);
  }
  errno = 0; const int result = kill(pid, SIGTERM); const int error = result < 0 ? errno : 0;
  std::lock_guard<std::mutex> lock(ledgerMutex);
  ledger.controlReturned = result == 0; ledger.controlError = error;
  RecordLocked("control-return", result, error, SIGTERM);
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
  ledger.notificationCallbackStatus = status;
  RecordLocked("notification-callback", status);
}

static void Finalize(napi_env, void*, void*) {
  Record("tsfn-finalizer-enter");
  // The worker records its final state under the ledger lock, so join outside it.
  try {
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
  int status = 0, error = 0;
  pid_t result;
  do {
    Record("wait-enter", pid);
    errno = 0; result = waitpid(pid, &status, 0); error = result < 0 ? errno : 0;
    Record("wait-return", result, error, result == pid ? status : 0);
  } while (result == -1 && error == EINTR);
  int code = 0, signal = 0;
  const bool decoded = result == pid && (WIFEXITED(status) || WIFSIGNALED(status));
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.waitError = error; ledger.waitConfirmed = decoded;
    if (decoded) {
      if (WIFEXITED(status)) code = WEXITSTATUS(status);
      if (WIFSIGNALED(status)) signal = WTERMSIG(status);
      ledger.exitCode = code; ledger.signalCode = signal;
    }
  }
  napi_status notification = napi_ok;
  if (decoded) {
    std::unique_ptr<ExitPayload, PayloadDeleter> payload(new (std::nothrow) ExitPayload{code, signal});
    if (payload) {
      { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.payloadAllocated = true; RecordLocked("payload-allocated"); }
      Record("notification-enter");
      notification = napi_call_threadsafe_function(tsfn, payload.get(), napi_tsfn_blocking);
      if (notification == napi_ok) payload.release();
      { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.notificationStatus = notification; RecordLocked("notification-return", notification); }
    } else Record("payload-allocation-failed", -1, ENOMEM);
  }
  if (notification != napi_closing) Release(tsfn);
  else Record("tsfn-release-not-attempted", notification);
  { std::lock_guard<std::mutex> lock(ledgerMutex); ledger.threadFinished = true; RecordLocked("thread-finished", pid); }
}

static void SetupExitCallback(Napi::Env env, Napi::Function cb, pid_t pid) {
  napi_value name;
  napi_status status = napi_create_string_utf8(env, "DscFailureWaiter", NAPI_AUTO_LENGTH, &name);
  if (status != napi_ok) { Record("tsfn-name-error", status); throw Napi::Error::New(env, "Could not create diagnostic TSFN name"); }
  napi_threadsafe_function tsfn = nullptr;
  Record("tsfn-create-enter");
  status = napi_create_threadsafe_function(env, cb, nullptr, name, 0, 1, nullptr, Finalize, nullptr, Notify, &tsfn);
  {
    std::lock_guard<std::mutex> lock(ledgerMutex);
    ledger.tsfnCreateStatus = status; ledger.tsfnCreated = status == napi_ok;
    RecordLocked("tsfn-create-return", status);
  }
  if (status != napi_ok) throw Napi::Error::New(env, "Could not create diagnostic TSFN");
  try { waiter = std::thread(Wait, tsfn, pid); }
  catch (const std::system_error& error) {
    Record("thread-start-error", -1, error.code().value());
    Release(tsfn);
    throw Napi::Error::New(env, "Could not start diagnostic waiter");
  }
}

}  // namespace dsc_failure
#endif
