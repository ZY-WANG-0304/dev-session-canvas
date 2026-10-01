#pragma once

#ifndef _WIN32
#error Windows execution owner requires Windows
#endif

#include <condition_variable>
#include <cmath>
#include <functional>
#include <memory>
#include <mutex>
#include <stdexcept>

namespace dsc_windows {

struct OwnedHandle {
  HANDLE value = nullptr;
  bool acquired = false;
  bool closeAttempted = false;
  DWORD closeError = 0;
};

struct Owner {
  std::mutex mutex;
  std::condition_variable idle;
  std::string token;
  bool busy = true;
  bool closeRequested = false;
  bool closeCalled = false;
  bool closeReturned = false;
  bool connectAttempted = false;
  bool connected = false;
  bool ownerAcquired = false;
  bool processAcquired = false;
  bool releaseAttempted = false;
  HRESULT releaseResult = E_PENDING;
  HRESULT resizeResult = E_PENDING;
  DWORD pid = 0;
  DWORD exitCode = 0;
  DWORD waitError = 0;
  std::string processState = "not-started";
  std::string error;
  HMODULE library = nullptr;
  HPCON hpc = nullptr;
  bool libraryCloseAttempted = false;
  DWORD libraryCloseError = 0;
  OwnedHandle input;
  OwnedHandle output;
  OwnedHandle thread;
  OwnedHandle process;
  std::wstring inputName;
  std::wstring outputName;
  decltype(&ConptyCreatePseudoConsole) create = nullptr;
  decltype(&ConptyResizePseudoConsole) resize = nullptr;
  decltype(&ConptyReleasePseudoConsole) release = nullptr;
  decltype(&ConptyClosePseudoConsole) close = nullptr;
};

static std::shared_ptr<Owner> currentOwner;

static std::string ReadToken(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsString()) throw Napi::TypeError::New(info.Env(), "Execution token is required");
  const auto token = info[0].As<Napi::String>().Utf8Value();
  if (token.empty() || token.size() > 512 || token.find('\0') != std::string::npos) {
    throw Napi::TypeError::New(info.Env(), "Invalid execution token");
  }
  return token;
}

static std::shared_ptr<Owner> GetOwner(const Napi::CallbackInfo& info) {
  const auto token = ReadToken(info);
  if (!currentOwner || currentOwner->token != token) throw Napi::Error::New(info.Env(), "Unknown execution owner");
  return currentOwner;
}

static void RequireArgs(const Napi::CallbackInfo& info, size_t count) {
  if (info.Length() != count) throw Napi::TypeError::New(info.Env(), "Invalid execution arguments");
}

static SHORT Dimension(const Napi::CallbackInfo& info, size_t index) {
  if (!info[index].IsNumber()) throw Napi::TypeError::New(info.Env(), "Invalid terminal dimension");
  const double value = info[index].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(value) || value < 1 || value > 1000 || std::floor(value) != value) {
    throw Napi::TypeError::New(info.Env(), "Invalid terminal dimension");
  }
  return static_cast<SHORT>(value);
}

static void SaveError(const std::shared_ptr<Owner>& owner, const std::string& error) {
  std::lock_guard<std::mutex> lock(owner->mutex);
  if (owner->error.empty()) owner->error = error;
}

static void Acquire(OwnedHandle& owned, HANDLE value) {
  owned.value = value;
  owned.acquired = value != nullptr && value != INVALID_HANDLE_VALUE;
}

static void CloseOwned(OwnedHandle& owned) {
  if (!owned.acquired || owned.closeAttempted) return;
  owned.closeAttempted = true;
  if (CloseHandle(owned.value)) owned.value = nullptr;
  else owned.closeError = GetLastError();
}

static bool OwnerReleased(const Owner& owner) {
  return !owner.hpc && !owner.library && !owner.input.value && !owner.output.value && !owner.thread.value;
}

static Napi::Object SnapshotObject(Napi::Env env, const std::shared_ptr<Owner>& owner) {
  std::lock_guard<std::mutex> lock(owner->mutex);
  auto result = Napi::Object::New(env);
  result.Set("token", owner->token);
  result.Set("busy", owner->busy);
  result.Set("ownerAcquired", owner->ownerAcquired);
  result.Set("ownerReleased", OwnerReleased(*owner));
  result.Set("processAcquired", owner->processAcquired);
  result.Set("processReleased", !owner->process.value);
  result.Set("processState", owner->processState);
  result.Set("pid", owner->pid ? Napi::Number::New(env, owner->pid).As<Napi::Value>() : env.Null());
  result.Set("exitCode", owner->processState == "exited" ? Napi::Number::New(env, owner->exitCode).As<Napi::Value>() : env.Null());
  result.Set("waitError", Napi::Number::New(env, owner->waitError));
  result.Set("closeRequested", owner->closeRequested);
  result.Set("closeCalled", owner->closeCalled);
  result.Set("closeReturned", owner->closeReturned);
  result.Set("connectAttempted", owner->connectAttempted);
  result.Set("connected", owner->connected);
  result.Set("releaseAttempted", owner->releaseAttempted);
  result.Set("releaseResult", Napi::Number::New(env, static_cast<int32_t>(owner->releaseResult)));
  result.Set("resizeResult", Napi::Number::New(env, static_cast<int32_t>(owner->resizeResult)));
  result.Set("error", owner->error.empty() ? env.Null() : Napi::String::New(env, owner->error).As<Napi::Value>());
  auto handles = Napi::Object::New(env);
  const std::pair<const char*, const OwnedHandle*> entries[] = {
    {"input", &owner->input}, {"output", &owner->output}, {"thread", &owner->thread}, {"process", &owner->process}
  };
  for (const auto& entry : entries) {
    auto handle = Napi::Object::New(env);
    handle.Set("acquired", entry.second->acquired);
    handle.Set("released", !entry.second->value);
    handle.Set("closeAttempted", entry.second->closeAttempted);
    handle.Set("closeError", Napi::Number::New(env, entry.second->closeError));
    handles.Set(entry.first, handle);
  }
  result.Set("handles", handles);
  result.Set("libraryCloseError", Napi::Number::New(env, owner->libraryCloseError));
  return result;
}

class NativeWork final : public Napi::AsyncWorker {
 public:
  using Work = std::function<void()>;
  using Result = std::function<Napi::Value(Napi::Env)>;
  NativeWork(Napi::Env env, std::shared_ptr<Owner> owner, Work work, Result result, bool closing = false)
    : Napi::AsyncWorker(env), deferred(Napi::Promise::Deferred::New(env)), owner(std::move(owner)),
      work(std::move(work)), result(std::move(result)), closing(closing) {}
  Napi::Promise Promise() { return deferred.Promise(); }
  void Execute() override {
    if (closing) {
      std::unique_lock<std::mutex> lock(owner->mutex);
      owner->idle.wait(lock, [this] { return !owner->busy; });
      owner->busy = true;
    }
    try { work(); }
    catch (const std::exception& error) { SaveError(owner, error.what()); SetError(error.what()); }
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      owner->busy = false;
    }
    owner->idle.notify_all();
  }
  void OnOK() override { deferred.Resolve(result(Env())); }
  void OnError(const Napi::Error& error) override { deferred.Reject(error.Value()); }
 private:
  Napi::Promise::Deferred deferred;
  std::shared_ptr<Owner> owner;
  Work work;
  Result result;
  bool closing;
};

static void Claim(const Napi::CallbackInfo& info, const std::shared_ptr<Owner>& owner) {
  std::lock_guard<std::mutex> lock(owner->mutex);
  if (owner->busy || owner->closeRequested) throw Napi::Error::New(info.Env(), "Execution owner is busy or closing");
  owner->busy = true;
}

static Napi::Value Queue(NativeWork* work) {
  auto promise = work->Promise();
  work->Queue();
  return promise;
}

static Napi::Value executionStart(const Napi::CallbackInfo& info) {
  RequireArgs(info, 4);
  const auto token = ReadToken(info);
  if (currentOwner) throw Napi::Error::New(info.Env(), "Execution owner is already configured");
  if (!info[1].IsString()) throw Napi::TypeError::New(info.Env(), "Pipe name is required");
  const auto pipeName = info[1].As<Napi::String>().Utf16Value();
  if (pipeName.empty() || pipeName.size() > 128 || pipeName.find_first_not_of(u"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-") != std::u16string::npos) {
    throw Napi::TypeError::New(info.Env(), "Invalid owned pipe name");
  }
  const COORD dimensions = { Dimension(info, 2), Dimension(info, 3) };
  auto owner = std::make_shared<Owner>();
  owner->token = token;
  currentOwner = owner;
  // Locate this addon by address, not an ambiguous process-wide conpty.node basename.
  try {
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&executionStart), &module)) {
      throw std::runtime_error("Could not locate execution addon module");
    }
    std::vector<wchar_t> modulePath(32768);
    const DWORD length = GetModuleFileNameW(module, modulePath.data(), static_cast<DWORD>(modulePath.size()));
    if (!length || length >= modulePath.size()) throw std::runtime_error("Could not resolve execution addon path");
    const std::wstring filename(modulePath.data(), length);
    const auto separator = filename.find_last_of(L"\\/");
    if (separator == std::wstring::npos) throw std::runtime_error("Execution addon path is not absolute");
    const auto libraryPath = filename.substr(0, separator) + L"\\conpty\\conpty.dll";
    owner->library = LoadLibraryW(libraryPath.c_str());
    owner->ownerAcquired = owner->library != nullptr;
    if (!owner->library) throw std::runtime_error("Could not load bundled ConPTY library");
    owner->create = reinterpret_cast<decltype(owner->create)>(GetProcAddress(owner->library, "ConptyCreatePseudoConsole"));
    owner->resize = reinterpret_cast<decltype(owner->resize)>(GetProcAddress(owner->library, "ConptyResizePseudoConsole"));
    owner->release = reinterpret_cast<decltype(owner->release)>(GetProcAddress(owner->library, "ConptyReleasePseudoConsole"));
    owner->close = reinterpret_cast<decltype(owner->close)>(GetProcAddress(owner->library, "ConptyClosePseudoConsole"));
    if (!owner->create || !owner->resize || !owner->release || !owner->close) throw std::runtime_error("Missing bundled ConPTY API");
  } catch (const std::exception& error) {
    owner->busy = false;
    owner->error = error.what();
    throw Napi::Error::New(info.Env(), error.what());
  } catch (...) {
    owner->busy = false;
    owner->error = "Unknown bundled ConPTY loading failure";
    throw Napi::Error::New(info.Env(), owner->error);
  }
  const std::wstring name(pipeName.begin(), pipeName.end());
  return Queue(new NativeWork(info.Env(), owner, [owner, name, dimensions] {
    HANDLE input = INVALID_HANDLE_VALUE;
    HANDLE output = INVALID_HANDLE_VALUE;
    std::wstring inputName, outputName;
    if (!createDataServerPipe(true, L"in", &input, inputName, name)) throw std::runtime_error("Creating owned input pipe failed");
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      Acquire(owner->input, input);
      owner->inputName = inputName;
    }
    if (!createDataServerPipe(false, L"out", &output, outputName, name)) throw std::runtime_error("Creating owned output pipe failed");
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      Acquire(owner->output, output);
      owner->outputName = outputName;
    }
    HPCON hpc = nullptr;
    const HRESULT status = owner->create(dimensions, input, output, 0, &hpc);
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      owner->hpc = hpc;
    }
    if (FAILED(status) || !hpc) throw std::runtime_error("Creating owned pseudoconsole failed");
  }, [owner](Napi::Env env) {
    auto result = Napi::Object::New(env);
    std::lock_guard<std::mutex> lock(owner->mutex);
    result.Set("conin", path_util::wstring_to_string(owner->inputName));
    result.Set("conout", path_util::wstring_to_string(owner->outputName));
    return result;
  }));
}

static Napi::Value executionConnect(const Napi::CallbackInfo& info) {
  RequireArgs(info, 4);
  auto owner = GetOwner(info);
  if (!info[1].IsString() || !info[2].IsString() || !info[3].IsArray()) {
    throw Napi::TypeError::New(info.Env(), "Invalid process connection arguments");
  }
  const std::wstring commandLine = path_util::to_wstring(info[1].As<Napi::String>());
  const std::wstring cwd = path_util::to_wstring(info[2].As<Napi::String>());
  if (commandLine.empty() || commandLine.find(L'\0') != std::wstring::npos || cwd.find(L'\0') != std::wstring::npos) {
    throw Napi::TypeError::New(info.Env(), "Invalid process command line or directory");
  }
  std::wstring environment;
  const auto values = info[3].As<Napi::Array>();
  for (uint32_t i = 0; i < values.Length(); i++) {
    if (!values.Get(i).IsString()) throw Napi::TypeError::New(info.Env(), "Invalid environment value");
    const auto value = path_util::to_wstring(values.Get(i).As<Napi::String>());
    if (value.empty() || value.find(L'\0') != std::wstring::npos) throw Napi::TypeError::New(info.Env(), "Invalid environment value");
    environment += value;
    environment.push_back(L'\0');
  }
  environment.push_back(L'\0');
  if (environment.size() == 1) environment.push_back(L'\0');
  {
    std::lock_guard<std::mutex> lock(owner->mutex);
    if (!owner->hpc || owner->connectAttempted) throw Napi::Error::New(info.Env(), "Pseudoconsole cannot be connected");
  }
  Claim(info, owner);
  {
    std::lock_guard<std::mutex> lock(owner->mutex);
    owner->connectAttempted = true;
  }
  return Queue(new NativeWork(info.Env(), owner, [owner, commandLine, cwd, environment] {
    for (const HANDLE pipe : {owner->input.value, owner->output.value}) {
      if (!ConnectNamedPipe(pipe, nullptr) && GetLastError() != ERROR_PIPE_CONNECTED) {
        throw std::runtime_error("Connecting owned terminal pipe failed");
      }
    }
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    if (!bytes) throw std::runtime_error("Sizing process attributes failed");
    std::vector<BYTE> storage(bytes);
    const auto attributes = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &bytes)) throw std::runtime_error("Initializing process attributes failed");
    struct AttributesGuard {
      PPROC_THREAD_ATTRIBUTE_LIST value;
      ~AttributesGuard() { DeleteProcThreadAttributeList(value); }
    } guard{attributes};
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
        owner->hpc, sizeof(HPCON), nullptr, nullptr)) throw std::runtime_error("Attaching owned pseudoconsole failed");
    std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
    mutableCommand.push_back(L'\0');
    std::vector<wchar_t> mutableEnvironment(environment.begin(), environment.end());
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.lpAttributeList = attributes;
    PROCESS_INFORMATION child{};
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      if (owner->closeRequested) throw std::runtime_error("Execution closed before process creation");
    }
    if (!CreateProcessW(nullptr, mutableCommand.data(), nullptr, nullptr, false,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, mutableEnvironment.data(),
        cwd.empty() ? nullptr : cwd.c_str(), &startup.StartupInfo, &child)) {
      throw std::runtime_error("Creating owned terminal process failed");
    }
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      Acquire(owner->process, child.hProcess);
      Acquire(owner->thread, child.hThread);
      owner->processAcquired = true;
      owner->processState = "pending";
      owner->pid = child.dwProcessId;
    }
    const HRESULT released = owner->release(owner->hpc);
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      owner->releaseAttempted = true;
      owner->releaseResult = released;
      CloseOwned(owner->thread);
      CloseOwned(owner->input);
      CloseOwned(owner->output);
      owner->connected = SUCCEEDED(released) && !owner->thread.value && !owner->input.value && !owner->output.value;
    }
    if (FAILED(released)) throw std::runtime_error("Releasing ConPTY connection reference failed");
    if (!owner->connected) throw std::runtime_error("Closing owned connection handles failed");
  }, [owner](Napi::Env env) {
    auto result = Napi::Object::New(env);
    std::lock_guard<std::mutex> lock(owner->mutex);
    result.Set("pid", Napi::Number::New(env, owner->pid));
    return result;
  }));
}

static Napi::Value executionPollWait(const Napi::CallbackInfo& info) {
  RequireArgs(info, 1);
  auto owner = GetOwner(info);
  {
    std::lock_guard<std::mutex> lock(owner->mutex);
    if (owner->processState == "pending") {
      const DWORD wait = WaitForSingleObject(owner->process.value, 0);
      if (wait == WAIT_OBJECT_0) {
        DWORD code = 0;
        if (GetExitCodeProcess(owner->process.value, &code)) {
          owner->exitCode = code;
          owner->processState = "exited";
          CloseOwned(owner->process);
        } else {
          owner->waitError = GetLastError();
          owner->processState = "unknown";
        }
      } else if (wait != WAIT_TIMEOUT) {
        owner->waitError = GetLastError();
        owner->processState = "unknown";
      }
    }
  }
  return SnapshotObject(info.Env(), owner);
}

static Napi::Value executionResize(const Napi::CallbackInfo& info) {
  RequireArgs(info, 3);
  auto owner = GetOwner(info);
  const COORD dimensions = {Dimension(info, 1), Dimension(info, 2)};
  {
    std::lock_guard<std::mutex> lock(owner->mutex);
    if (!owner->connected || owner->processState != "pending") throw Napi::Error::New(info.Env(), "Terminal is not interactive");
  }
  Claim(info, owner);
  return Queue(new NativeWork(info.Env(), owner, [owner, dimensions] {
    const HRESULT result = owner->resize(owner->hpc, dimensions);
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      owner->resizeResult = result;
    }
    if (FAILED(result)) throw std::runtime_error("Resizing owned pseudoconsole failed");
  }, [](Napi::Env env) {
    auto result = Napi::Object::New(env);
    result.Set("kind", "resized");
    return result;
  }));
}

static Napi::Value executionClose(const Napi::CallbackInfo& info) {
  RequireArgs(info, 1);
  auto owner = GetOwner(info);
  {
    std::lock_guard<std::mutex> lock(owner->mutex);
    if (owner->closeRequested) throw Napi::Error::New(info.Env(), "Pseudoconsole close already requested");
    owner->closeRequested = true;
  }
  return Queue(new NativeWork(info.Env(), owner, [owner] {
    HPCON hpc;
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      CloseOwned(owner->thread);
      CloseOwned(owner->input);
      CloseOwned(owner->output);
      hpc = owner->hpc;
      owner->closeCalled = hpc != nullptr;
    }
    // ConPTY close may wait for its output reader. Never hold the state lock here.
    if (hpc) owner->close(hpc);
    {
      std::lock_guard<std::mutex> lock(owner->mutex);
      owner->hpc = nullptr;
      owner->closeReturned = true;
      if (owner->library && !owner->libraryCloseAttempted) {
        owner->libraryCloseAttempted = true;
        if (FreeLibrary(owner->library)) owner->library = nullptr;
        else owner->libraryCloseError = GetLastError();
      }
    }
  }, [owner](Napi::Env env) {
    auto result = Napi::Object::New(env);
    std::lock_guard<std::mutex> lock(owner->mutex);
    result.Set("kind", OwnerReleased(*owner) ? "closed" : "unknown");
    return result;
  }, true));
}

static Napi::Value executionSnapshot(const Napi::CallbackInfo& info) {
  RequireArgs(info, 1);
  return SnapshotObject(info.Env(), GetOwner(info));
}

}  // namespace dsc_windows
