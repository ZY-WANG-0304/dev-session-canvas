#ifndef DSC_LINUX_EXECUTION_OWNER_H
#define DSC_LINUX_EXECUTION_OWNER_H

#if !defined(__linux__)
#error "The execution owner supports Linux only"
#endif

#include <napi.h>
#include <cerrno>
#include <cstdint>
#include <signal.h>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

namespace dsc_execution {

struct Owner {
  napi_env env = nullptr;
  std::string token;
  bool configured = false;
  bool forkAttempted = false;
  pid_t pid = -1;
  int master = -1;
  int forkError = 0;
  bool childAcquired = false;
  bool masterAcquired = false;
  bool nonblockConfirmed = false;
  int nonblockError = 0;
  const char* waitKind = "not-started";
  int waitError = 0;
  int rawStatus = 0;
  int exitCode = 0;
  int signalCode = 0;
  bool waitTerminal = false;
  bool waitUnknown = false;
  bool closeAttempted = false;
  int closeResult = 0;
  int closeError = 0;
  bool readInFlight = false;
  bool readFinished = false;
  uint64_t readCalls = 0;
  uint64_t readBytes = 0;
  uint64_t pollCalls = 0;
  int termCalls = 0;
  int killCalls = 0;
  const char* lastReadKind = nullptr;
  int lastReadError = 0;
  const char* eofReason = nullptr;
};

// One provider environment owns one child; no other thread or reaper is installed.
static Owner owner;

static Napi::Value MaybeNumber(Napi::Env env, bool present, double value) {
  return present ? Napi::Number::New(env, value).As<Napi::Value>() : env.Null();
}

static void RequireToken(const Napi::CallbackInfo& info, size_t arguments) {
  if (info.Length() != arguments || !info[0].IsString())
    throw Napi::TypeError::New(info.Env(), "Invalid execution owner arguments");
  if (!owner.configured || owner.env != info.Env() ||
      info[0].As<Napi::String>().Utf8Value() != owner.token)
    throw Napi::Error::New(info.Env(), "Foreign execution owner");
}

static Napi::Object WaitStatus(Napi::Env env) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("kind", owner.waitKind);
  result.Set("exitCode", MaybeNumber(env, owner.waitTerminal && owner.signalCode == 0, owner.exitCode));
  result.Set("signalCode", MaybeNumber(env, owner.waitTerminal && owner.signalCode != 0, owner.signalCode));
  result.Set("rawStatus", MaybeNumber(env, owner.waitTerminal, owner.rawStatus));
  result.Set("errno", MaybeNumber(env, owner.waitError != 0, owner.waitError));
  return result;
}

static Napi::Object Result(Napi::Env env, const char* kind, int error = 0) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("kind", kind);
  result.Set("errno", MaybeNumber(env, error != 0, error));
  return result;
}

static Napi::Value Configure(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsString())
    throw Napi::TypeError::New(info.Env(), "executionConfigure requires a token");
  const std::string token = info[0].As<Napi::String>().Utf8Value();
  if (token.empty() || token.size() > 128 ||
      token.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::string::npos)
    throw Napi::TypeError::New(info.Env(), "Invalid execution owner token");
  if (owner.configured) throw Napi::Error::New(info.Env(), "Execution owner already configured");
  owner.token = token;
  owner.env = info.Env();
  owner.configured = true;
  return info.Env().Undefined();
}

static void BeforeFork(Napi::Env env) {
  if (!owner.configured || owner.env != env || owner.forkAttempted)
    throw Napi::Error::New(env, "Configure exactly one execution before fork");
  owner.forkAttempted = true;
}

static void ForkReturned(pid_t pid, int master, int error) {
  owner.forkError = error;
  if (pid <= 0) return;
  owner.pid = pid;
  owner.master = master;
  owner.childAcquired = true;
  owner.masterAcquired = master >= 0;
  owner.waitKind = "pending";
}

static void NonblockReturned(int result, int error) {
  owner.nonblockConfirmed = result == 0;
  owner.nonblockError = error;
}

static Napi::Value Snapshot(const Napi::CallbackInfo& info) {
  RequireToken(info, 1);
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  result.Set("token", owner.token);
  result.Set("configured", owner.configured);
  result.Set("forkAttempted", owner.forkAttempted);
  result.Set("pid", MaybeNumber(env, owner.childAcquired, owner.pid));
  result.Set("masterFd", MaybeNumber(env, owner.masterAcquired, owner.master));
  result.Set("forkErrno", MaybeNumber(env, owner.forkError != 0, owner.forkError));
  result.Set("childAcquired", owner.childAcquired);
  result.Set("masterAcquired", owner.masterAcquired);
  result.Set("nonblockConfirmed", owner.nonblockConfirmed);
  result.Set("nonblockErrno", MaybeNumber(env, owner.nonblockError != 0, owner.nonblockError));
  result.Set("waitStatus", WaitStatus(env));
  result.Set("closeAttempted", owner.closeAttempted);
  result.Set("closeResult", MaybeNumber(env, owner.closeAttempted, owner.closeResult));
  result.Set("closeErrno", MaybeNumber(env, owner.closeError != 0, owner.closeError));
  result.Set("readCalls", static_cast<double>(owner.readCalls));
  result.Set("readBytes", static_cast<double>(owner.readBytes));
  result.Set("pollCalls", static_cast<double>(owner.pollCalls));
  result.Set("termCalls", owner.termCalls);
  result.Set("killCalls", owner.killCalls);
  result.Set("lastReadKind", owner.lastReadKind ? Napi::String::New(env, owner.lastReadKind).As<Napi::Value>() : env.Null());
  result.Set("lastReadErrno", MaybeNumber(env, owner.lastReadError != 0, owner.lastReadError));
  result.Set("eofReason", owner.eofReason ? Napi::String::New(env, owner.eofReason).As<Napi::Value>() : env.Null());
  return result;
}

static Napi::Value Read(const Napi::CallbackInfo& info) {
  RequireToken(info, 2);
  if (!info[1].IsBuffer()) throw Napi::TypeError::New(info.Env(), "executionRead requires a Buffer");
  Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() != 4096)
    throw Napi::TypeError::New(info.Env(), "executionRead requires exactly 4096 bytes");
  if (!owner.masterAcquired || !owner.nonblockConfirmed || owner.closeAttempted ||
      owner.readInFlight || owner.readFinished)
    throw Napi::Error::New(info.Env(), "Master is not available for reading");
  owner.readInFlight = true;
  ++owner.readCalls;
  errno = 0;
  const ssize_t count = read(owner.master, buffer.Data(), buffer.Length());
  const int error = count < 0 ? errno : 0;
  owner.readInFlight = false;
  owner.lastReadError = error;
  if (count > 0) {
    owner.readBytes += static_cast<uint64_t>(count);
    owner.lastReadKind = "data";
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("kind", "data");
    result.Set("bytes", static_cast<double>(count));
    return result;
  }
  if (count < 0 && (error == EAGAIN || error == EWOULDBLOCK || error == EINTR)) {
    owner.lastReadKind = "retry";
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("kind", "retry");
    return result;
  }
  owner.readFinished = true;
  if (count == 0 || error == EIO) {
    owner.lastReadKind = "eof";
    owner.eofReason = count == 0 ? "zero" : "eio";
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("kind", "eof");
    result.Set("reason", owner.eofReason);
    return result;
  }
  owner.lastReadKind = "error";
  return Result(info.Env(), "error", error);
}

// A zero return preserves an unreaped child identity until this same owner polls again.
static bool PollOnce() {
  if (!owner.childAcquired || owner.waitTerminal || owner.waitUnknown) return false;
  int status = 0;
  ++owner.pollCalls;
  errno = 0;
  const pid_t result = waitpid(owner.pid, &status, WNOHANG);
  const int error = result < 0 ? errno : 0;
  owner.waitError = error;
  if (result == 0 || (result < 0 && error == EINTR)) {
    owner.waitKind = "pending";
    return result == 0;
  }
  if (result == owner.pid && (WIFEXITED(status) || WIFSIGNALED(status))) {
    owner.waitTerminal = true;
    owner.rawStatus = status;
    owner.exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : 0;
    owner.signalCode = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
    owner.waitKind = WIFEXITED(status) ? "exited" : "signaled";
    return false;
  }
  owner.waitUnknown = true;
  owner.waitKind = "unknown";
  return false;
}

static Napi::Value PollWait(const Napi::CallbackInfo& info) {
  RequireToken(info, 1);
  PollOnce();
  return WaitStatus(info.Env());
}

static Napi::Value Signal(const Napi::CallbackInfo& info) {
  RequireToken(info, 2);
  if (!info[1].IsString()) throw Napi::TypeError::New(info.Env(), "executionSignal requires SIGTERM or SIGKILL");
  const std::string signal = info[1].As<Napi::String>().Utf8Value();
  if (signal != "SIGTERM" && signal != "SIGKILL")
    throw Napi::TypeError::New(info.Env(), "Unsupported execution signal");
  const bool pending = PollOnce();
  if (!owner.childAcquired || owner.waitTerminal) return Result(info.Env(), "not-running");
  if (!pending) return Result(info.Env(), "unknown", owner.waitError);
  int& calls = signal == "SIGTERM" ? owner.termCalls : owner.killCalls;
  if (calls != 0) return Result(info.Env(), "already-attempted");
  ++calls;
  errno = 0;
  const int result = kill(owner.pid, signal == "SIGTERM" ? SIGTERM : SIGKILL);
  const int error = result < 0 ? errno : 0;
  return Result(info.Env(), result == 0 ? "sent" : "error", error);
}

static Napi::Value Close(const Napi::CallbackInfo& info) {
  RequireToken(info, 1);
  if (!owner.masterAcquired) return Result(info.Env(), "not-acquired");
  if (owner.closeAttempted) return Result(info.Env(), "already-attempted", owner.closeError);
  if (owner.readInFlight) throw Napi::Error::New(info.Env(), "Cannot close an in-flight master");
  owner.closeAttempted = true;
  errno = 0;
  owner.closeResult = close(owner.master);
  owner.closeError = owner.closeResult < 0 ? errno : 0;
  return Result(info.Env(), owner.closeResult == 0 ? "closed" : "error", owner.closeError);
}

}  // namespace dsc_execution

#endif
