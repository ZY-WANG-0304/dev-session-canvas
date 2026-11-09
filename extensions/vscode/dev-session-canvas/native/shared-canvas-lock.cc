#include <node_api.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#else
#include <cerrno>
#include <cstdlib>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace shared_canvas_lock {

constexpr size_t MaxRequests = 256;
constexpr size_t MaxHandles = 512;
const napi_type_tag HandleTag = {0x8bfe026a7b9942c1ULL, 0x9fc3256b5b51aacdULL};

struct Failure {
  std::string code;
  std::string operation;
  std::string message;
  int64_t nativeCode = 0;
};

struct Handle {
  std::string path;
  std::string parent;
  std::string basename;
  bool acquired = false;
  std::atomic<bool> counted{true};
  std::string unlockResult = "not-held";
  std::string fileCloseResult = "not-open";
  std::string directoryCloseResult = "not-open";
  std::vector<Failure> releaseFailures;
#ifdef _WIN32
  HANDLE file = INVALID_HANDLE_VALUE;
  HANDLE directory = INVALID_HANDLE_VALUE;
  std::wstring widePath;
  std::wstring wideParent;
#else
  int file = -1;
  int directory = -1;
#endif
};

struct Context;
struct Box {
  std::weak_ptr<Context> context;
  std::shared_ptr<Handle> handle;
  bool acquiring = false;
  bool closing = false;
  napi_ref closePromise = nullptr;
};

enum class Kind { Open, Acquire, Close };

struct Request {
  Kind kind;
  std::shared_ptr<Handle> handle;
  Box* box = nullptr;
  napi_deferred deferred = nullptr;
  napi_ref reference = nullptr;
  bool notify = true;
  bool busy = false;
  std::vector<Failure> failures;
  std::string unlockResult = "not-held";
  std::string fileCloseResult = "not-open";
  std::string directoryCloseResult = "not-open";
};

struct Context : std::enable_shared_from_this<Context> {
  napi_env env;
  napi_threadsafe_function completion = nullptr;
  napi_async_cleanup_hook_handle cleanup = nullptr;
  std::atomic<bool> stopping{false};
  std::atomic<size_t> handleCount{0};
  size_t pending = 0;
  std::mutex mutex;
  std::condition_variable wake;
  std::deque<Request*> requests;
  std::unordered_map<Handle*, std::shared_ptr<Handle>> handles;
  std::thread worker;
};

static Failure Invalid(const char* operation, const char* message) {
  return {"ERR_SHARED_CANVAS_LOCK_PATH", operation, message, 0};
}

static Failure SystemFailure(const char* operation, int64_t nativeCode) {
  const char* code = "ERR_SHARED_CANVAS_LOCK_IO";
#ifdef _WIN32
  if (nativeCode == ERROR_ACCESS_DENIED || nativeCode == ERROR_PRIVILEGE_NOT_HELD)
    code = "ERR_SHARED_CANVAS_LOCK_PERMISSION";
  if (nativeCode == ERROR_NOT_SUPPORTED || nativeCode == ERROR_INVALID_FUNCTION)
    code = "ERR_SHARED_CANVAS_LOCK_UNSUPPORTED";
#else
  if (nativeCode == EACCES || nativeCode == EPERM) code = "ERR_SHARED_CANVAS_LOCK_PERMISSION";
  if (nativeCode == ENOSYS || nativeCode == ENOTSUP) code = "ERR_SHARED_CANVAS_LOCK_UNSUPPORTED";
#endif
  std::string message = std::string(operation) + " failed (native error " + std::to_string(nativeCode) + ")";
#ifndef _WIN32
  if (nativeCode == EINTR && std::string(operation).rfind("close(", 0) == 0) {
#ifdef __linux__
    message += "; Linux has released this descriptor; close is not retried";
#else
    message += "; descriptor state after EINTR is not established on this platform; close is not retried";
#endif
  }
#endif
  return {code, operation, std::move(message), nativeCode};
}

#ifdef _WIN32

static std::wstring Wide(const std::string& value) {
  const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (!length) throw SystemFailure("MultiByteToWideChar", GetLastError());
  std::wstring result(length, L'\0');
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), length))
    throw SystemFailure("MultiByteToWideChar", GetLastError());
  return result;
}

static void ValidateAcl(HANDLE object) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) throw SystemFailure("OpenProcessToken", GetLastError());
  DWORD length = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &length);
  std::vector<unsigned char> information(length);
  const bool read = GetTokenInformation(token, TokenUser, information.data(), length, &length) != 0;
  const DWORD tokenError = GetLastError();
  CloseHandle(token);
  if (!read) throw SystemFailure("GetTokenInformation", tokenError);
  PSID user = reinterpret_cast<TOKEN_USER*>(information.data())->User.Sid;
  PSID owner = nullptr;
  PACL acl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  const DWORD status = GetSecurityInfo(object, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
    &owner, nullptr, &acl, nullptr, &descriptor);
  if (status != ERROR_SUCCESS) throw SystemFailure("GetSecurityInfo", status);
  bool valid = owner && EqualSid(owner, user) && acl && IsValidAcl(acl);
  for (DWORD index = 0; valid && index < acl->AceCount; ++index) {
    void* entry = nullptr;
    if (!GetAce(acl, index, &entry)) { valid = false; break; }
    const auto* header = static_cast<ACE_HEADER*>(entry);
    if (header->AceFlags & INHERIT_ONLY_ACE) continue;
    if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) { valid = false; break; }
    auto* allowed = static_cast<ACCESS_ALLOWED_ACE*>(entry);
    PSID trustee = &allowed->SidStart;
    valid = IsValidSid(trustee) && (EqualSid(trustee, user) || IsWellKnownSid(trustee, WinLocalSystemSid) ||
      IsWellKnownSid(trustee, WinBuiltinAdministratorsSid));
  }
  LocalFree(descriptor);
  if (!valid) throw Invalid("validateAcl", "Lock objects require a private, current-user-owned ACL");
}

static BY_HANDLE_FILE_INFORMATION Information(HANDLE object, bool directory) {
  BY_HANDLE_FILE_INFORMATION result{};
  if (!GetFileInformationByHandle(object, &result)) throw SystemFailure("GetFileInformationByHandle", GetLastError());
  if ((result.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
      bool(result.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != directory ||
      (!directory && (result.nNumberOfLinks != 1 || result.nFileSizeHigh || result.nFileSizeLow)))
    throw Invalid("validateIdentity", "Expected a private directory or an empty, singly-linked regular lock file");
  ValidateAcl(object);
  return result;
}

static bool SameFile(const BY_HANDLE_FILE_INFORMATION& left, const BY_HANDLE_FILE_INFORMATION& right) {
  return left.dwVolumeSerialNumber == right.dwVolumeSerialNumber && left.nFileIndexHigh == right.nFileIndexHigh &&
    left.nFileIndexLow == right.nFileIndexLow;
}

static HANDLE OpenWindows(const std::wstring& path, bool directory, bool create) {
  HANDLE result = CreateFileW(path.c_str(), READ_CONTROL | (directory ? FILE_READ_ATTRIBUTES : GENERIC_READ | GENERIC_WRITE),
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, create ? OPEN_ALWAYS : OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL), nullptr);
  if (result == INVALID_HANDLE_VALUE) throw SystemFailure("CreateFileW", GetLastError());
  return result;
}

static void Validate(Handle& handle) {
  const auto file = Information(handle.file, false);
  const auto directory = Information(handle.directory, true);
  HANDLE currentDirectory = INVALID_HANDLE_VALUE;
  HANDLE currentFile = INVALID_HANDLE_VALUE;
  try {
    currentDirectory = OpenWindows(handle.wideParent, true, false);
    currentFile = OpenWindows(handle.widePath, false, false);
    if (!SameFile(directory, Information(currentDirectory, true)) || !SameFile(file, Information(currentFile, false)))
      throw Invalid("validateIdentity", "Lock pathname no longer identifies the opened object");
  } catch (...) {
    if (currentFile != INVALID_HANDLE_VALUE) CloseHandle(currentFile);
    if (currentDirectory != INVALID_HANDLE_VALUE) CloseHandle(currentDirectory);
    throw;
  }
  const bool fileClosed = CloseHandle(currentFile) != 0;
  const DWORD fileError = GetLastError();
  const bool directoryClosed = CloseHandle(currentDirectory) != 0;
  const DWORD directoryError = GetLastError();
  if (!fileClosed) throw SystemFailure("CloseHandle(validation file)", fileError);
  if (!directoryClosed) throw SystemFailure("CloseHandle(validation directory)", directoryError);
}

static void OpenNative(Handle& handle) {
  handle.widePath = Wide(handle.path);
  const auto separator = handle.widePath.find_last_of(L"\\/");
  if (separator == std::wstring::npos || separator + 1 == handle.widePath.size()) throw Invalid("open", "Expected an absolute lock path");
  handle.wideParent = handle.widePath.substr(0, separator);
  const auto basename = handle.widePath.substr(separator + 1);
  if (basename.find(L':') != std::wstring::npos || basename.back() == L'.' || basename.back() == L' ')
    throw Invalid("open", "Alternate streams and aliased lock filenames are not supported");
  handle.directory = OpenWindows(handle.wideParent, true, false);
  std::vector<wchar_t> canonical(32768);
  const DWORD size = GetFinalPathNameByHandleW(handle.directory, canonical.data(), static_cast<DWORD>(canonical.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!size || size >= canonical.size()) throw SystemFailure("GetFinalPathNameByHandleW", GetLastError());
  std::wstring expected = handle.wideParent;
  if (expected.rfind(L"\\\\?\\", 0) != 0) {
    if (expected.size() < 3 || expected[1] != L':' || expected[2] != L'\\')
      throw Invalid("open", "Expected a canonical absolute DOS lock path");
    expected = L"\\\\?\\" + expected;
  }
  if (CompareStringOrdinal(expected.c_str(), static_cast<int>(expected.size()), canonical.data(), size, TRUE) != CSTR_EQUAL)
    throw Invalid("open", "Lock parent must be canonical, without aliases or reparse points");
  Information(handle.directory, true);
  handle.file = OpenWindows(handle.widePath, false, true);
  Validate(handle);
}

static bool AcquireNative(Handle& handle) {
  Validate(handle);
  OVERLAPPED region{};
  if (!LockFileEx(handle.file, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &region)) {
    const DWORD error = GetLastError();
    if (error == ERROR_LOCK_VIOLATION) return false;
    throw SystemFailure("LockFileEx", error);
  }
  handle.acquired = true;
  Validate(handle);
  return true;
}

static void CloseNative(Handle& handle, std::vector<Failure>& failures) {
  if (handle.file != INVALID_HANDLE_VALUE) {
    if (handle.acquired) {
      OVERLAPPED region{};
      const bool unlocked = UnlockFileEx(handle.file, 0, 1, 0, &region) != 0;
      const DWORD error = GetLastError();
      handle.unlockResult = unlocked ? "succeeded" : "failed";
      if (!unlocked) failures.push_back(SystemFailure("UnlockFileEx", error));
    }
    const HANDLE file = handle.file;
    handle.file = INVALID_HANDLE_VALUE;
    const bool closed = CloseHandle(file) != 0;
    const DWORD error = GetLastError();
    handle.fileCloseResult = closed ? "succeeded" : "failed";
    if (!closed) failures.push_back(SystemFailure("CloseHandle(file)", error));
  }
  if (handle.directory != INVALID_HANDLE_VALUE) {
    const HANDLE directory = handle.directory;
    handle.directory = INVALID_HANDLE_VALUE;
    const bool closed = CloseHandle(directory) != 0;
    const DWORD error = GetLastError();
    handle.directoryCloseResult = closed ? "succeeded" : "failed";
    if (!closed) failures.push_back(SystemFailure("CloseHandle(directory)", error));
  }
  handle.acquired = false;
}

#else

static bool SameFile(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino;
}

static void Validate(Handle& handle) {
  struct stat directory{}, namedDirectory{}, file{}, namedFile{};
  if (fstat(handle.directory, &directory) || lstat(handle.parent.c_str(), &namedDirectory) ||
      fstat(handle.file, &file) || fstatat(handle.directory, handle.basename.c_str(), &namedFile, AT_SYMLINK_NOFOLLOW))
    throw SystemFailure("stat(lock identity)", errno);
  if (!S_ISDIR(directory.st_mode) || directory.st_uid != geteuid() || (directory.st_mode & 07777) != 0700 ||
      !SameFile(directory, namedDirectory) || !S_ISDIR(namedDirectory.st_mode) ||
      !S_ISREG(file.st_mode) || file.st_uid != geteuid() || (file.st_mode & 07777) != 0600 || file.st_nlink != 1 || file.st_size != 0 ||
      !S_ISREG(namedFile.st_mode) || !SameFile(file, namedFile))
    throw Invalid("validateIdentity", "Lock identity, ownership, permissions, type, link count or size is invalid");
}

static void OpenNative(Handle& handle) {
  const auto separator = handle.path.find_last_of('/');
  if (handle.path.front() != '/' || separator == std::string::npos || separator + 1 == handle.path.size())
    throw Invalid("open", "Expected an absolute lock file path");
  handle.parent = handle.path.substr(0, separator);
  handle.basename = handle.path.substr(separator + 1);
  char* canonical = realpath(handle.parent.c_str(), nullptr);
  if (!canonical) throw SystemFailure("realpath(parent)", errno);
  const bool matches = handle.parent == canonical;
  free(canonical);
  if (!matches) throw Invalid("open", "Lock parent must be canonical without symlink aliases");
  handle.directory = open(handle.parent.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (handle.directory < 0) throw SystemFailure("open(parent)", errno);
  struct stat directory{};
  if (fstat(handle.directory, &directory)) throw SystemFailure("fstat(parent)", errno);
  if (directory.st_uid != geteuid() || (directory.st_mode & 07777) != 0700)
    throw Invalid("open", "Lock directory must be current-user-owned with mode 0700");
  handle.file = openat(handle.directory, handle.basename.c_str(), O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
  if (handle.file < 0) throw SystemFailure("openat(lock)", errno);
  Validate(handle);
}

static bool AcquireNative(Handle& handle) {
  Validate(handle);
  if (flock(handle.file, LOCK_EX | LOCK_NB)) {
    const int error = errno;
    if (error == EWOULDBLOCK || error == EAGAIN) return false;
    throw SystemFailure("flock(LOCK_EX)", error);
  }
  handle.acquired = true;
  Validate(handle);
  return true;
}

static void CloseNative(Handle& handle, std::vector<Failure>& failures) {
  if (handle.file >= 0) {
    if (handle.acquired) {
      const bool unlocked = flock(handle.file, LOCK_UN) == 0;
      const int error = errno;
      handle.unlockResult = unlocked ? "succeeded" : "failed";
      if (!unlocked) failures.push_back(SystemFailure("flock(LOCK_UN)", error));
    }
    const int file = handle.file;
    handle.file = -1;
    const bool closed = close(file) == 0;
    const int error = errno;
    handle.fileCloseResult = closed ? "succeeded" : "failed";
    if (!closed) failures.push_back(SystemFailure("close(file)", error));
  }
  if (handle.directory >= 0) {
    const int directory = handle.directory;
    handle.directory = -1;
    const bool closed = close(directory) == 0;
    const int error = errno;
    handle.directoryCloseResult = closed ? "succeeded" : "failed";
    if (!closed) failures.push_back(SystemFailure("close(directory)", error));
  }
  handle.acquired = false;
}

#endif

static void Retire(Context& context, const std::shared_ptr<Handle>& handle, std::vector<Failure>& failures) {
  if (!handle->counted) {
    failures.insert(failures.end(), handle->releaseFailures.begin(), handle->releaseFailures.end());
    return;
  }
  const size_t previous = failures.size();
  CloseNative(*handle, failures);
  handle->releaseFailures.assign(failures.begin() + previous, failures.end());
  context.handles.erase(handle.get());
  handle->counted = false;
  --context.handleCount;
}

static void Execute(Context& context, Request& request) {
  try {
    if (request.kind == Kind::Open) {
      OpenNative(*request.handle);
      context.handles.emplace(request.handle.get(), request.handle);
    } else if (request.kind == Kind::Acquire) {
      if (request.handle->acquired)
        throw Failure{"ERR_SHARED_CANVAS_LOCK_ALREADY_ACQUIRED", "tryAcquire", "This handle already owns its lock", 0};
      if (!context.handles.count(request.handle.get()))
        throw Failure{"ERR_SHARED_CANVAS_LOCK_CLOSED", "tryAcquire", "This handle is closed", 0};
      request.busy = !AcquireNative(*request.handle);
    } else {
      Retire(context, request.handle, request.failures);
    }
  } catch (const Failure& error) {
    request.failures.push_back(error);
    if (request.kind == Kind::Open || (request.kind == Kind::Acquire && error.code != "ERR_SHARED_CANVAS_LOCK_ALREADY_ACQUIRED"))
      Retire(context, request.handle, request.failures);
  } catch (const std::exception& error) {
    request.failures.push_back({"ERR_SHARED_CANVAS_LOCK_IO", "native", error.what(), 0});
    Retire(context, request.handle, request.failures);
  }
}

static void Worker(Context* context) {
  bool channelOpen = true;
  for (;;) {
    Request* request = nullptr;
    {
      std::unique_lock<std::mutex> guard(context->mutex);
      context->wake.wait(guard, [&] { return context->stopping || !context->requests.empty(); });
      if (context->requests.empty()) break;
      request = context->requests.front();
      context->requests.pop_front();
    }
    Execute(*context, *request);
    request->unlockResult = request->handle->unlockResult;
    request->fileCloseResult = request->handle->fileCloseResult;
    request->directoryCloseResult = request->handle->directoryCloseResult;
    if (!request->notify || context->stopping) {
      delete request;
    } else {
      const auto status = napi_call_threadsafe_function(context->completion, request, napi_tsfn_blocking);
      if (status != napi_ok) {
        delete request;
        if (status != napi_closing)
          napi_fatal_error("shared-canvas-lock", NAPI_AUTO_LENGTH, "Native completion channel failed", NAPI_AUTO_LENGTH);
        channelOpen = false;
        context->stopping = true;
      }
    }
  }
  while (!context->handles.empty()) {
    const auto handle = context->handles.begin()->second;
    std::vector<Failure> failures;
    Retire(*context, handle, failures);
  }
  if (channelOpen) napi_release_threadsafe_function(context->completion, napi_tsfn_release);
}

static napi_value Text(napi_env env, const std::string& text) {
  napi_value value;
  napi_create_string_utf8(env, text.data(), text.size(), &value);
  return value;
}

static napi_value Error(napi_env env, const Failure& failure) {
  napi_value value, number;
  napi_create_error(env, Text(env, failure.code), Text(env, failure.message), &value);
  napi_set_named_property(env, value, "syscall", Text(env, failure.operation));
  napi_create_int64(env, failure.nativeCode, &number);
  napi_set_named_property(env, value, "nativeCode", number);
  return value;
}

static napi_value DetailedError(napi_env env, const std::vector<Failure>& failures,
    const std::string& unlockResult, const std::string& fileCloseResult, const std::string& directoryCloseResult) {
  napi_value error = Error(env, failures.front());
  napi_value cleanup, release;
  napi_create_array_with_length(env, failures.size() - 1, &cleanup);
  for (size_t index = 1; index < failures.size(); ++index)
    napi_set_element(env, cleanup, index - 1, Error(env, failures[index]));
  napi_set_named_property(env, error, "cleanupErrors", cleanup);
  napi_create_object(env, &release);
  napi_set_named_property(env, release, "unlock", Text(env, unlockResult));
  napi_set_named_property(env, release, "fileClose", Text(env, fileCloseResult));
  napi_set_named_property(env, release, "directoryClose", Text(env, directoryCloseResult));
  napi_set_named_property(env, error, "release", release);
  return error;
}

static napi_value Reject(napi_env env, const char* code, const char* message) {
  napi_deferred deferred;
  napi_value promise;
  napi_create_promise(env, &deferred, &promise);
  napi_reject_deferred(env, deferred, Error(env, {code, "request", message, 0}));
  return promise;
}

static void Enqueue(const std::shared_ptr<Context>& context, Request* request) {
  {
    std::lock_guard<std::mutex> guard(context->mutex);
    context->requests.push_back(request);
  }
  context->wake.notify_one();
}

static void FinalizeHandle(napi_env env, void* data, void*) {
  std::unique_ptr<Box> box(static_cast<Box*>(data));
  const auto context = box->context.lock();
  if (context && !context->stopping) {
    if (box->closePromise) napi_delete_reference(env, box->closePromise);
    if (!box->closing && box->handle->counted)
      Enqueue(context, new Request{Kind::Close, box->handle, nullptr, nullptr, nullptr, false, false, {}});
  }
}

static void Complete(napi_env env, napi_value, void* data, void* payload) {
  auto* context = static_cast<Context*>(data);
  std::unique_ptr<Request> request(static_cast<Request*>(payload));
  if (!env || context->stopping) return;
  if (request->box && request->kind == Kind::Acquire) request->box->acquiring = false;
  if (!request->failures.empty()) {
    napi_reject_deferred(env, request->deferred, DetailedError(env, request->failures,
      request->unlockResult, request->fileCloseResult, request->directoryCloseResult));
  } else {
    napi_value result;
    if (request->kind == Kind::Open) {
      napi_create_object(env, &result);
      auto* owner = new Box{context->shared_from_this(), request->handle};
      napi_wrap(env, result, owner, FinalizeHandle, nullptr, nullptr);
      napi_type_tag_object(env, result, &HandleTag);
      napi_object_freeze(env, result);
    } else if (request->kind == Kind::Acquire) {
      result = Text(env, request->busy ? "busy" : "acquired");
    } else {
      napi_get_undefined(env, &result);
    }
    napi_resolve_deferred(env, request->deferred, result);
  }
  if (request->reference) napi_delete_reference(env, request->reference);
  if (--context->pending == 0) napi_unref_threadsafe_function(env, context->completion);
}

static napi_value Invoke(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 1;
  napi_value argument;
  void* data = nullptr;
  napi_get_cb_info(env, info, &count, &argument, nullptr, &data);
  auto context = *static_cast<std::shared_ptr<Context>*>(data);
  if (context->stopping) return Reject(env, "ERR_SHARED_CANVAS_LOCK_CLOSED", "The native environment is stopping");
  Box* box = nullptr;
  if (kind != Kind::Open) {
    bool matches = false;
    napi_valuetype type;
    if (count != 1 || napi_typeof(env, argument, &type) != napi_ok || type != napi_object ||
        napi_check_object_type_tag(env, argument, &HandleTag, &matches) != napi_ok || !matches ||
        napi_unwrap(env, argument, reinterpret_cast<void**>(&box)) != napi_ok || !box || box->context.lock() != context)
      return Reject(env, "ERR_SHARED_CANVAS_LOCK_HANDLE", "Expected a lock handle belonging to this environment");
    if (kind == Kind::Close && box->closePromise) {
      napi_value promise;
      napi_get_reference_value(env, box->closePromise, &promise);
      return promise;
    }
    if (box->closing) return Reject(env, "ERR_SHARED_CANVAS_LOCK_CLOSED", "This handle is closing or closed");
    if (!box->handle->counted) {
      if (kind == Kind::Acquire) return Reject(env, "ERR_SHARED_CANVAS_LOCK_CLOSED", "This handle has been retired");
      napi_value promise, result;
      napi_deferred deferred;
      napi_create_promise(env, &deferred, &promise);
      if (box->handle->releaseFailures.empty()) {
        napi_get_undefined(env, &result);
        napi_resolve_deferred(env, deferred, result);
      } else {
        napi_reject_deferred(env, deferred, DetailedError(env, box->handle->releaseFailures,
          box->handle->unlockResult, box->handle->fileCloseResult, box->handle->directoryCloseResult));
      }
      napi_create_reference(env, promise, 1, &box->closePromise);
      box->closing = true;
      return promise;
    }
    if (kind == Kind::Acquire && box->acquiring)
      return Reject(env, "ERR_SHARED_CANVAS_LOCK_REQUEST_PENDING", "This handle already has an acquisition in flight");
  }
  if (kind != Kind::Close && context->pending >= MaxRequests)
    return Reject(env, "ERR_SHARED_CANVAS_LOCK_QUEUE_FULL", "The native request limit has been reached");
  auto request = std::make_unique<Request>();
  request->kind = kind;
  request->box = box;
  if (kind == Kind::Open) {
    napi_valuetype type;
    if (count != 1 || napi_typeof(env, argument, &type) != napi_ok || type != napi_string)
      return Reject(env, "ERR_SHARED_CANVAS_LOCK_PATH", "Expected an absolute lock path string");
    size_t size = 0;
    napi_get_value_string_utf8(env, argument, nullptr, 0, &size);
    if (!size || size > 32768) return Reject(env, "ERR_SHARED_CANVAS_LOCK_PATH", "Invalid lock path length");
    std::vector<char> bytes(size + 1);
    napi_get_value_string_utf8(env, argument, bytes.data(), bytes.size(), &size);
    std::string path(bytes.data(), size);
    if (path.find('\0') != std::string::npos) return Reject(env, "ERR_SHARED_CANVAS_LOCK_PATH", "Lock paths cannot contain NUL");
    if (context->handleCount >= MaxHandles)
      return Reject(env, "ERR_SHARED_CANVAS_LOCK_HANDLE_LIMIT", "The native open handle limit has been reached");
    request->handle = std::make_shared<Handle>();
    request->handle->path = std::move(path);
    ++context->handleCount;
  } else {
    request->handle = box->handle;
    napi_create_reference(env, argument, 1, &request->reference);
  }
  napi_value promise;
  napi_create_promise(env, &request->deferred, &promise);
  if (kind == Kind::Close) {
    box->closing = true;
    napi_create_reference(env, promise, 1, &box->closePromise);
  } else if (kind == Kind::Acquire) box->acquiring = true;
  if (context->pending++ == 0) napi_ref_threadsafe_function(env, context->completion);
  Enqueue(context, request.release());
  return promise;
}

static napi_value Open(napi_env env, napi_callback_info info) { return Invoke(env, info, Kind::Open); }
static napi_value Acquire(napi_env env, napi_callback_info info) { return Invoke(env, info, Kind::Acquire); }
static napi_value Close(napi_env env, napi_callback_info info) { return Invoke(env, info, Kind::Close); }

static void Cleanup(napi_async_cleanup_hook_handle, void* data) {
  auto* context = static_cast<Context*>(data);
  {
    std::lock_guard<std::mutex> guard(context->mutex);
    context->stopping = true;
  }
  context->wake.notify_one();
}

static void FinalizeContext(napi_env, void* data, void*) {
  std::unique_ptr<std::shared_ptr<Context>> owner(static_cast<std::shared_ptr<Context>*>(data));
  auto context = *owner;
  if (context->worker.joinable()) context->worker.join();
  if (context->cleanup) napi_remove_async_cleanup_hook(context->cleanup);
}

static napi_value Initialize(napi_env env, napi_value exports) {
  auto context = std::make_shared<Context>();
  context->env = env;
  auto* owner = new std::shared_ptr<Context>(context);
  napi_value name = Text(env, "shared-canvas-lock");
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, MaxRequests + MaxHandles, 1, owner, FinalizeContext,
      context.get(), Complete, &context->completion) != napi_ok) {
    delete owner;
    napi_throw_error(env, "ERR_SHARED_CANVAS_LOCK_INIT", "Cannot create lock completion channel");
    return nullptr;
  }
  if (napi_add_async_cleanup_hook(env, Cleanup, context.get(), &context->cleanup) != napi_ok) {
    napi_release_threadsafe_function(context->completion, napi_tsfn_abort);
    napi_throw_error(env, "ERR_SHARED_CANVAS_LOCK_INIT", "Cannot register native environment cleanup");
    return nullptr;
  }
  napi_unref_threadsafe_function(env, context->completion);
  const napi_property_descriptor methods[] = {
    {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, owner},
    {"tryAcquire", nullptr, Acquire, nullptr, nullptr, nullptr, napi_default, owner},
    {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, owner}
  };
  napi_define_properties(env, exports, 3, methods);
  try {
    context->worker = std::thread(Worker, context.get());
  } catch (const std::exception& error) {
    napi_release_threadsafe_function(context->completion, napi_tsfn_abort);
    napi_throw_error(env, "ERR_SHARED_CANVAS_LOCK_INIT", error.what());
    return nullptr;
  }
  return exports;
}

}

NAPI_MODULE(NODE_GYP_MODULE_NAME, shared_canvas_lock::Initialize)
