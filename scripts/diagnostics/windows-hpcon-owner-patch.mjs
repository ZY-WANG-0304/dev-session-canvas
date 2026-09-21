import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_RELATIVE_PATH = 'node_modules/node-pty/src/win/conpty.cc';
export const SOURCE_SHA256 = 'd502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2';
export const HEADER_SHA256 = '32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c';
export const PATCH_SCHEMA = 1;

const MARKER = 'DSC_HPCON_OWNER_PATCH_V1';
const require = createRequire(import.meta.url);
const INCLUDE_ANCHOR = '#include "conpty.h"';
const BATON_ANCHOR = 'struct pty_baton {';
const EXIT_ANCHOR = 'struct ExitEvent {';
const KILL_ANCHOR = 'static Napi::Value PtyKill(const Napi::CallbackInfo& info) {';
const INIT_ANCHOR = 'Napi::Object init(Napi::Env env, Napi::Object exports) {';

const EVENT_NAMES = Object.freeze([
  'owner-created', 'release-called', 'release-returned', 'shell-exited',
  'shell-handle-closed', 'exit-enqueue-request', 'exit-event-enqueued', 'exit-callback-delivered',
  'exit-tsfn-release',
  'native-exit-thread-done', 'mark-pipe-eof', 'mark-consumer-complete',
  'close-request', 'close-invoked', 'close-returned', 'owner-closed',
  'baton-removed', 'operation-rejected',
]);

export const API_SCHEMA = Object.freeze({
  schema: PATCH_SCHEMA,
  marker: MARKER,
  exports: {
    startProcess: 'existing result gains generation:string',
    connect: 'existing result gains generation:string',
    markPipeEof: '(ptyId:number, generation:string) -> {ok:boolean,error:string|null,state:object|null}',
    markConsumerComplete: '(ptyId:number, generation:string) -> {ok:boolean,error:string|null,state:object|null}',
    closeAfterExit: '(ptyId:number, generation:string, useConptyDll:boolean) -> {ok:boolean,error:string|null,state:object|null}',
    ownerSnapshot: '() -> {schema:number,qpcFrequency:string|null,owners:object[],events:event[]}',
  },
  events: EVENT_NAMES,
  gate: [
    'shellExited', 'shellHandleClosed', 'releaseSucceeded',
    'exitEventEnqueued', 'exitCallbackDelivered', 'nativeExitThreadDone',
    'pipeEof', 'consumerComplete',
  ],
  forbidden: ['PtyKill', 'TerminateProcess', 'CloseHandle(HPCON)'],
  semantics: {
    releaseSucceeded: 'SUCCEEDED(HRESULT) from the existing Release call using the fixed header declaration',
    nativeExitThreadDone: 'TSFN finalizer joined the native exit thread',
    eventOrder: 'exit-event-enqueued records BlockingCall acceptance and may follow exit-callback-delivered',
    qpcTicks: 'decimal string preserving the full native counter value',
    generation: 'process-local monotonic owner nonce; pair with driver process identity',
  },
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveSourcePath() {
  return path.join(path.dirname(require.resolve('node-pty/package.json')), 'src/win/conpty.cc');
}

function verifyHeader(header) {
  requireLf(header);
  assert.equal(sha256(header), HEADER_SHA256, 'unexpected conpty.h SHA256');
  assert(header.includes('CONPTY_EXPORT HRESULT WINAPI ConptyReleasePseudoConsole(HPCON hPC);'));
  return HEADER_SHA256;
}

function requireLf(source) {
  assert(!source.includes('\r'), 'conpty.cc must use LF line endings');
  assert(source.endsWith('\n'), 'conpty.cc must end with LF');
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function replaceOnce(source, before, after, operations, label) {
  const first = source.indexOf(before);
  assert(first >= 0, `missing source anchor: ${label}`);
  assert.equal(source.indexOf(before, first + before.length), -1, `ambiguous source anchor: ${label}`);
  operations.push({ label, line: lineNumber(source, first), before, after });
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function insertAfter(source, anchor, text, operations, label) {
  return replaceOnce(source, anchor, anchor + text, operations, label);
}

function renderPatch(operations) {
  return operations.map(operation => {
    const oldLines = operation.before.split('\n');
    const newLines = operation.after.split('\n');
    const oldBody = oldLines.map(line => `-${line}`).join('\n');
    const newBody = newLines.map(line => `+${line}`).join('\n');
    return [
      `@@ ${operation.label} line ${operation.line} -${oldLines.length} +${newLines.length} @@`,
      oldBody,
      newBody,
    ].join('\n');
  }).join('\n');
}

function cppOwnerBlock() {
  return `

/* ${MARKER}: guarded HPCON owner lifecycle; diagnostic fork only. */
struct dsc_owner_event {
  unsigned long long seq;
  std::string name;
  int id;
  unsigned long long generation;
  bool ok;
  DWORD error;
  LARGE_INTEGER qpc;
  DWORD thread_id;
};

static std::atomic<unsigned long long> dsc_generation{0};
static unsigned long long dsc_event_sequence = 0;
static std::vector<dsc_owner_event> dsc_owner_events;

static unsigned long long dsc_next_generation() {
  return ++dsc_generation;
}

static void dsc_record_event_values_locked(int id, unsigned long long generation,
                                           const char* name, bool ok, DWORD error) {
  dsc_owner_event event{};
  event.seq = ++dsc_event_sequence;
  event.name = name;
  event.id = id;
  event.generation = generation;
  event.ok = ok;
  event.error = error;
  QueryPerformanceCounter(&event.qpc);
  event.thread_id = GetCurrentThreadId();
  dsc_owner_events.emplace_back(std::move(event));
}

static void dsc_record_event_locked(const pty_baton* baton, const char* name, bool ok, DWORD error) {
  dsc_record_event_values_locked(baton ? baton->id : 0,
                                 baton ? baton->generation : 0, name, ok, error);
}

static pty_baton* dsc_find_owner_locked(int id, unsigned long long generation) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id, generation](const auto& owner) {
    return owner->id == id && owner->generation == generation;
  });
  return it == ptyHandles.end() ? nullptr : it->get();
}

static bool dsc_remove_owner_locked(pty_baton* baton) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [baton](const auto& owner) {
    return owner.get() == baton;
  });
  if (it == ptyHandles.end()) return false;
  ptyHandles.erase(it);
  return true;
}

static Napi::Object dsc_owner_state(Napi::Env env, const pty_baton* owner) {
  auto state = Napi::Object::New(env);
  if (!owner) return state;
  state.Set("id", owner->id);
  state.Set("generation", std::to_string(owner->generation));
  state.Set("hpcPresent", owner->hpc != nullptr);
  state.Set("hShellPresent", owner->hShell != nullptr);
  state.Set("shellExited", owner->shellExited);
  state.Set("shellHandleClosed", owner->shellHandleClosed);
  state.Set("releaseCalled", owner->releaseCalled);
  state.Set("releaseSucceeded", owner->releaseSucceeded);
  state.Set("releaseHresult", static_cast<double>(owner->releaseHresult));
  state.Set("connectClaimed", owner->connectClaimed);
  state.Set("exitEventEnqueued", owner->exitEventEnqueued);
  state.Set("exitCallbackDelivered", owner->exitCallbackDelivered);
  state.Set("nativeExitThreadDone", owner->nativeExitThreadDone);
  state.Set("pipeEof", owner->pipeEof);
  state.Set("consumerComplete", owner->consumerComplete);
  state.Set("closeInFlight", owner->closeInFlight);
  state.Set("closeInvoked", owner->closeInvoked);
  state.Set("ownerClosed", owner->ownerClosed);
  state.Set("batonRemoved", owner->batonRemoved);
  state.Set("lifecycleFailed", owner->lifecycleFailed);
  state.Set("pid", owner->pid);
  state.Set("exitCode", owner->exitCode);
  return state;
}

static Napi::Object dsc_operation_result(Napi::Env env, bool ok, const char* error, const pty_baton* owner) {
  auto result = Napi::Object::New(env);
  result.Set("ok", ok);
  if (error) result.Set("error", error); else result.Set("error", env.Null());
  if (owner) result.Set("state", dsc_owner_state(env, owner)); else result.Set("state", env.Null());
  return result;
}
`;
}

function cppBatonPatch() {
  return `static unsigned long long dsc_next_generation();

struct pty_baton {
  int id;
  unsigned long long generation;
  HANDLE hIn;
  HANDLE hOut;
  HPCON hpc;

  HANDLE hShell;
  PFNCLOSEPSEUDOCONSOLE closeFn = nullptr;
  DWORD pid;
  DWORD exitCode;
  bool shellExited = false;
  bool shellHandleClosed = false;
  bool releaseCalled = false;
  bool releaseSucceeded = false;
  HRESULT releaseHresult = E_PENDING;
  bool connectClaimed = false;
  bool exitEventEnqueued = false;
  bool exitCallbackDelivered = false;
  bool nativeExitThreadDone = false;
  bool pipeEof = false;
  bool consumerComplete = false;
  bool closeInFlight = false;
  bool closeInvoked = false;
  bool ownerClosed = false;
  bool batonRemoved = false;
  bool lifecycleFailed = false;

  pty_baton(int _id, HANDLE _hIn, HANDLE _hOut, HPCON _hpc)
      : id(_id), generation(dsc_next_generation()), hIn(_hIn), hOut(_hOut), hpc(_hpc),
        hShell(nullptr), pid(0), exitCode(STILL_ACTIVE) {}
};`;
}

function cppExitEventPatch() {
  return `struct ExitEvent {
  int exit_code = 0;
  int id = 0;
  unsigned long long generation = 0;
};

void SetupExitCallback(Napi::Env env, Napi::Function cb, pty_baton* baton) {
  int id;
  unsigned long long generation;
  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    id = baton->id;
    generation = baton->generation;
  }
  std::thread *th = new std::thread;
  auto tsfn = Napi::ThreadSafeFunction::New(
      env, cb, "SetupExitCallback_resource", 0, 1,
      [th, id, generation](Napi::Env) {
        th->join();
        delete th;
        std::lock_guard<std::mutex> lock(dsc_pty_mutex);
        auto owner = dsc_find_owner_locked(id, generation);
        if (owner) {
          owner->nativeExitThreadDone = true;
          dsc_record_event_locked(owner, "native-exit-thread-done", !owner->lifecycleFailed,
                                  owner->lifecycleFailed ? ERROR_GEN_FAILURE : 0);
        }
      });
  *th = std::thread([tsfn = std::move(tsfn), baton] {
    auto callback = [](Napi::Env env, Napi::Function cb, ExitEvent *raw_event) {
      std::unique_ptr<ExitEvent> exit_event(raw_event);
      if (env == nullptr || cb.IsEmpty()) return;
      try {
        cb.Call({Napi::Number::New(env, exit_event->exit_code)});
      } catch (...) {
        std::lock_guard<std::mutex> lock(dsc_pty_mutex);
        auto owner = dsc_find_owner_locked(exit_event->id, exit_event->generation);
        if (owner) {
          owner->lifecycleFailed = true;
          dsc_record_event_locked(owner, "operation-rejected", false, ERROR_GEN_FAILURE);
        }
        throw;
      }
      {
        std::lock_guard<std::mutex> lock(dsc_pty_mutex);
        auto owner = dsc_find_owner_locked(exit_event->id, exit_event->generation);
        if (owner) {
          const bool ok = !env.IsExceptionPending();
          owner->exitCallbackDelivered = ok;
          if (!ok) owner->lifecycleFailed = true;
          dsc_record_event_locked(owner, "exit-callback-delivered", ok, ok ? 0 : ERROR_GEN_FAILURE);
        }
      }
    };

    std::unique_ptr<ExitEvent> exit_event(new ExitEvent);
    HANDLE shell = nullptr;
    DWORD expected_pid = 0;
    {
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      shell = baton->hShell;
      expected_pid = baton->pid;
      exit_event->id = baton->id;
      exit_event->generation = baton->generation;
    }
    DWORD exit_code = 0;
    DWORD failure = ERROR_INVALID_HANDLE;
    bool exited = false;
    if (shell != nullptr) {
      const DWORD wait_result = WaitForSingleObject(shell, INFINITE);
      if (wait_result != WAIT_OBJECT_0) {
        failure = wait_result == WAIT_FAILED ? GetLastError() : ERROR_GEN_FAILURE;
      } else if (!GetExitCodeProcess(shell, &exit_code)) {
        failure = GetLastError();
      } else {
        const DWORD actual_pid = GetProcessId(shell);
        if (actual_pid == 0) failure = GetLastError();
        else if (actual_pid != expected_pid) failure = ERROR_INVALID_DATA;
        else exited = true;
      }
    }
    {
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      if (exited && baton->hShell == shell) {
        exit_event->exit_code = static_cast<int>(exit_code);
        baton->exitCode = exit_code;
        baton->shellExited = true;
        dsc_record_event_locked(baton, "shell-exited", true, 0);
        const BOOL closed = CloseHandle(shell);
        const DWORD close_error = closed ? 0 : GetLastError();
        if (closed) baton->hShell = nullptr;
        baton->shellHandleClosed = closed != FALSE;
        if (!closed) baton->lifecycleFailed = true;
        dsc_record_event_locked(baton, "shell-handle-closed", closed != FALSE, close_error);
      } else {
        baton->lifecycleFailed = true;
        exited = false;
        dsc_record_event_locked(baton, "operation-rejected", false, failure);
      }
    }
    napi_status enqueue_status = napi_ok;
    if (exited) {
      {
        std::lock_guard<std::mutex> lock(dsc_pty_mutex);
        dsc_record_event_locked(baton, "exit-enqueue-request", true, 0);
      }
      ExitEvent* queued_event = exit_event.release();
      enqueue_status = tsfn.BlockingCall(queued_event, callback);
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      if (enqueue_status == napi_ok) {
        baton->exitEventEnqueued = true;
        dsc_record_event_locked(baton, "exit-event-enqueued", true, 0);
      } else {
        delete queued_event;
        baton->lifecycleFailed = true;
        dsc_record_event_locked(baton, "operation-rejected", false, static_cast<DWORD>(enqueue_status));
      }
    }
    // napi_closing forbids further calls on the TSFN, including Release.
    if (enqueue_status != napi_closing) {
      const napi_status release_status = tsfn.Release();
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      if (release_status != napi_ok) baton->lifecycleFailed = true;
      dsc_record_event_locked(baton, "exit-tsfn-release", release_status == napi_ok,
                              static_cast<DWORD>(release_status));
    }
  });
}`;
}

function cppOwnerApiPatch() {
  return `
static bool dsc_parse_generation(const Napi::Value& value, unsigned long long* generation) {
  if (!value.IsString()) return false;
  const auto text = value.As<Napi::String>().Utf8Value();
  if (text.empty() || text[0] == '0' || text.find_first_not_of("0123456789") != std::string::npos) return false;
  try { *generation = std::stoull(text); } catch (...) { return false; }
  return *generation != 0;
}

static bool dsc_parse_owner_args(const Napi::CallbackInfo& info, int* id,
                                 unsigned long long* generation) {
  if (info.Length() < 2 || !info[0].IsNumber() || !dsc_parse_generation(info[1], generation)) return false;
  const double raw_id = info[0].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(raw_id) || raw_id <= 0 || raw_id > INT_MAX || std::floor(raw_id) != raw_id) return false;
  *id = static_cast<int>(raw_id);
  return true;
}

static Napi::Value dsc_mark_gate(const Napi::CallbackInfo& info, bool pipe_eof) {
  Napi::Env env(info.Env());
  int id = 0;
  unsigned long long generation = 0;
  if (info.Length() != 2 || !dsc_parse_owner_args(info, &id, &generation))
    return dsc_operation_result(env, false, "invalid-arguments", nullptr);
  std::lock_guard<std::mutex> lock(dsc_pty_mutex);
  auto owner = dsc_find_owner_locked(id, generation);
  if (!owner) return dsc_operation_result(env, false, "unknown-owner", nullptr);
  if (owner->lifecycleFailed || owner->closeInFlight || owner->ownerClosed || (!pipe_eof && !owner->pipeEof)) {
    dsc_record_event_locked(owner, "operation-rejected", false, ERROR_INVALID_STATE);
    return dsc_operation_result(env, false, "gate-precondition-failed", owner);
  }
  bool& gate = pipe_eof ? owner->pipeEof : owner->consumerComplete;
  const char* name = pipe_eof ? "mark-pipe-eof" : "mark-consumer-complete";
  if (gate) {
    dsc_record_event_locked(owner, "operation-rejected", false, ERROR_ALREADY_EXISTS);
    return dsc_operation_result(env, false, "duplicate-gate", owner);
  }
  gate = true;
  dsc_record_event_locked(owner, name, true, 0);
  return dsc_operation_result(env, true, nullptr, owner);
}

static Napi::Value PtyMarkPipeEof(const Napi::CallbackInfo& info) {
  return dsc_mark_gate(info, true);
}

static Napi::Value PtyMarkConsumerComplete(const Napi::CallbackInfo& info) {
  return dsc_mark_gate(info, false);
}

static Napi::Value PtyCloseAfterExit(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  int id = 0;
  unsigned long long generation = 0;
  if (!dsc_parse_owner_args(info, &id, &generation) || info.Length() != 3 || !info[2].IsBoolean())
    return dsc_operation_result(env, false, "invalid-arguments", nullptr);
  const bool useConptyDll = info[2].As<Napi::Boolean>().Value();
  if (!useConptyDll) return dsc_operation_result(env, false, "dll-backend-required", nullptr);
  HPCON hpc = nullptr;
  PFNCLOSEPSEUDOCONSOLE closeFn = nullptr;
  pty_baton* owner = nullptr;
  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    owner = dsc_find_owner_locked(id, generation);
    if (!owner) return dsc_operation_result(env, false, "unknown-owner", nullptr);
    if (owner->lifecycleFailed || !owner->shellExited || !owner->shellHandleClosed ||
        !owner->releaseSucceeded || !owner->exitEventEnqueued || !owner->exitCallbackDelivered ||
        !owner->nativeExitThreadDone || !owner->pipeEof || !owner->consumerComplete)
      return dsc_operation_result(env, false, "close-before-gates", owner);
    if (owner->closeInFlight || owner->closeInvoked || owner->ownerClosed)
      return dsc_operation_result(env, false, "duplicate-close", owner);
    owner->closeInFlight = true;
    hpc = owner->hpc;
    closeFn = owner->closeFn;
    dsc_record_event_locked(owner, "close-request", true, 0);
  }
  if (!hpc) {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    owner->closeInFlight = false;
    owner->lifecycleFailed = true;
    dsc_record_event_locked(owner, "operation-rejected", false, ERROR_INVALID_HANDLE);
    return dsc_operation_result(env, false, "missing-hpc", owner);
  }
  if (!closeFn) {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    owner->closeInFlight = false;
    owner->lifecycleFailed = true;
    dsc_record_event_locked(owner, "operation-rejected", false, ERROR_PROC_NOT_FOUND);
    return dsc_operation_result(env, false, "close-unsupported", owner);
  }
  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    owner->closeInvoked = true;
    dsc_record_event_locked(owner, "close-invoked", true, 0);
  }
  closeFn(hpc);
  std::lock_guard<std::mutex> lock(dsc_pty_mutex);
  owner->closeInFlight = false;
  owner->ownerClosed = true;
  owner->hpc = nullptr;
  dsc_record_event_locked(owner, "close-returned", true, 0);
  dsc_record_event_locked(owner, "owner-closed", true, 0);
  const int ownerId = owner->id;
  const unsigned long long ownerGeneration = owner->generation;
  owner->batonRemoved = false;
  auto state = dsc_owner_state(env, owner);
  const bool removed = dsc_remove_owner_locked(owner);
  state.Set("batonRemoved", removed);
  if (!removed) dsc_record_event_values_locked(ownerId, ownerGeneration, "operation-rejected", false, ERROR_NOT_FOUND);
  dsc_record_event_values_locked(ownerId, ownerGeneration, "baton-removed", removed,
                                 removed ? 0 : ERROR_NOT_FOUND);
  auto result = Napi::Object::New(env);
  result.Set("ok", removed);
  if (removed) result.Set("error", env.Null()); else result.Set("error", "baton-remove-failed");
  result.Set("state", state);
  return result;
}

static Napi::Value PtyOwnerSnapshot(const Napi::CallbackInfo& info) {
  Napi::Env env(info.Env());
  std::lock_guard<std::mutex> lock(dsc_pty_mutex);
  auto result = Napi::Object::New(env);
  result.Set("schema", ${PATCH_SCHEMA});
  LARGE_INTEGER frequency{};
  if (QueryPerformanceFrequency(&frequency)) result.Set("qpcFrequency", std::to_string(frequency.QuadPart));
  else result.Set("qpcFrequency", env.Null());
  auto owners = Napi::Array::New(env, ptyHandles.size());
  for (size_t i = 0; i < ptyHandles.size(); i++) owners.Set(i, dsc_owner_state(env, ptyHandles[i].get()));
  result.Set("owners", owners);
  auto events = Napi::Array::New(env, dsc_owner_events.size());
  for (size_t i = 0; i < dsc_owner_events.size(); i++) {
    const auto& event = dsc_owner_events[i];
    auto value = Napi::Object::New(env);
    value.Set("seq", static_cast<double>(event.seq));
    value.Set("event", event.name);
    value.Set("id", event.id);
    value.Set("generation", std::to_string(event.generation));
    value.Set("qpcTicks", std::to_string(event.qpc.QuadPart));
    value.Set("threadId", event.thread_id);
    value.Set("ok", event.ok);
    value.Set("error", event.error);
    events.Set(i, value);
  }
  result.Set("events", events);
  return result;
}
`;
}

function cppExportPatch() {
  return `  exports.Set("markPipeEof", Napi::Function::New(env, PtyMarkPipeEof));
  exports.Set("markConsumerComplete", Napi::Function::New(env, PtyMarkConsumerComplete));
  exports.Set("closeAfterExit", Napi::Function::New(env, PtyCloseAfterExit));
  exports.Set("ownerSnapshot", Napi::Function::New(env, PtyOwnerSnapshot));
`;
}

function cppDisabledPtyApi(name) {
  return `static Napi::Value ${name}(const Napi::CallbackInfo& info) {
  throw Napi::Error::New(info.Env(), "diagnostic owner fork does not expose ${name}");
}`;
}

function cppCreateOwnerPatch() {
  return `unsigned long long ownerGeneration = 0;

  if (SUCCEEDED(hr)) {
    // We were able to instantiate a conpty.
    const int ptyId = InterlockedIncrement(&ptyCounter);
    auto owner = std::make_unique<pty_baton>(ptyId, hIn, hOut, hpc);
    ownerGeneration = owner->generation;
    {
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      ptyHandles.emplace_back(std::move(owner));
      dsc_record_event_locked(ptyHandles.back().get(), "owner-created", true, 0);
    }
    marshal.Set("pty", Napi::Number::New(env, ptyId));
    marshal.Set("generation", std::to_string(ownerGeneration));
  } else {
    throw Napi::Error::New(env, "Cannot launch conpty");
  }`;
}

function cppReleasePatch() {
  return `  HANDLE hLibrary = LoadConptyDll(info, useConptyDll);
  bool fLoadedDll = hLibrary != nullptr;
  if (useConptyDll && fLoadedDll)
  {
    const auto pfnReleasePseudoConsole = reinterpret_cast<decltype(&ConptyReleasePseudoConsole)>(
      GetProcAddress((HMODULE)hLibrary, "ConptyReleasePseudoConsole"));
    {
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      handle->closeFn = reinterpret_cast<PFNCLOSEPSEUDOCONSOLE>(
        GetProcAddress((HMODULE)hLibrary, "ConptyClosePseudoConsole"));
      handle->releaseCalled = pfnReleasePseudoConsole != nullptr;
      dsc_record_event_locked(handle, "release-called", pfnReleasePseudoConsole != nullptr,
                              pfnReleasePseudoConsole ? 0 : ERROR_PROC_NOT_FOUND);
    }
    if (pfnReleasePseudoConsole)
    {
      const HRESULT releaseResult = pfnReleasePseudoConsole(ownerHpc);
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      handle->releaseHresult = releaseResult;
      handle->releaseSucceeded = SUCCEEDED(releaseResult);
      if (FAILED(releaseResult)) handle->lifecycleFailed = true;
      dsc_record_event_locked(handle, "release-returned", SUCCEEDED(releaseResult), static_cast<DWORD>(releaseResult));
    }
    else
    {
      std::lock_guard<std::mutex> lock(dsc_pty_mutex);
      handle->lifecycleFailed = true;
      dsc_record_event_locked(handle, "release-returned", false, ERROR_PROC_NOT_FOUND);
    }
  }
  else
  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    handle->lifecycleFailed = true;
    dsc_record_event_locked(handle, "release-returned", false, ERROR_NOT_SUPPORTED);
  }`;
}

export function patchConptyOwnerSource(source) {
  requireLf(source);
  const sourceHash = sha256(source);
  assert.equal(sourceHash, SOURCE_SHA256, `unexpected conpty.cc SHA256: ${sourceHash}`);
  assert(!source.includes(MARKER), 'conpty.cc already contains the owner patch marker');
  const operations = [];
  let patched = source;
  patched = insertAfter(patched, INCLUDE_ANCHOR,
    '\n#include <algorithm>\n#include <atomic>\n#include <climits>\n#include <cmath>\n#include <memory>\n#include <mutex>', operations, 'owner-includes');
  patched = insertAfter(patched, 'static std::vector<std::unique_ptr<pty_baton>> ptyHandles;',
    '\nstatic std::mutex dsc_pty_mutex;', operations, 'owner-lock');
  const batonStart = patched.indexOf(BATON_ANCHOR);
  const batonEnd = patched.indexOf('\n};', batonStart) + 3;
  assert(batonStart >= 0 && batonEnd > batonStart, 'missing pty_baton block');
  patched = replaceOnce(patched, patched.slice(batonStart, batonEnd), cppBatonPatch(), operations, 'owner-baton');
  const staticStart = patched.indexOf('static std::vector<std::unique_ptr<pty_baton>> ptyHandles;');
  const eventStart = patched.indexOf('struct ExitEvent {', staticStart);
  assert(staticStart >= 0 && eventStart > staticStart, 'missing owner table block');
  const ownerTable = patched.slice(staticStart, eventStart);
  patched = replaceOnce(patched, ownerTable, ownerTable + cppOwnerBlock(), operations, 'owner-state');
  const getBlock = `static pty_baton* get_pty_baton(int id) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    return it->get();
  }
  return nullptr;
}`;
  patched = replaceOnce(patched, getBlock, '', operations, 'owner-remove-legacy-get');
  const removeBlock = `static bool remove_pty_baton(int id) {
  auto it = std::remove_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    ptyHandles.erase(it);
    return true;
  }
  return false;
}`;
  patched = replaceOnce(patched, removeBlock, '', operations, 'owner-remove-legacy-remove');
  const createBlock = `if (SUCCEEDED(hr)) {
    // We were able to instantiate a conpty
    const int ptyId = InterlockedIncrement(&ptyCounter);
    marshal.Set("pty", Napi::Number::New(env, ptyId));
    ptyHandles.emplace_back(
        std::make_unique<pty_baton>(ptyId, hIn, hOut, hpc));
  } else {
    throw Napi::Error::New(env, "Cannot launch conpty");
  }`;
  patched = replaceOnce(patched, createBlock, cppCreateOwnerPatch(), operations, 'owner-create');
  const startBackend = '  const bool useConptyDll = info[6].As<Napi::Boolean>().Value();';
  patched = insertAfter(patched, startBackend,
    '\n  if (!useConptyDll) throw Napi::Error::New(env, "diagnostic owner start requires bundled DLL");',
    operations, 'owner-start-dll-only');
  const exitStart = patched.indexOf(EXIT_ANCHOR);
  const exitEnd = patched.indexOf('\nNapi::Error errorWithCode', exitStart);
  assert(exitStart >= 0 && exitEnd > exitStart, 'missing exit callback block');
  patched = replaceOnce(patched, patched.slice(exitStart, exitEnd), cppExitEventPatch(), operations, 'owner-exit-callback');
  const killStart = patched.indexOf(KILL_ANCHOR);
  assert(killStart >= 0, 'missing PtyKill anchor');
  const releaseBlock = `  HANDLE hLibrary = LoadConptyDll(info, useConptyDll);
  bool fLoadedDll = hLibrary != nullptr;
  if (useConptyDll && fLoadedDll)
  {
    PFNRELEASEPSEUDOCONSOLE const pfnReleasePseudoConsole = (PFNRELEASEPSEUDOCONSOLE)GetProcAddress(
      (HMODULE)hLibrary, "ConptyReleasePseudoConsole");
    if (pfnReleasePseudoConsole)
    {
      pfnReleasePseudoConsole(handle->hpc);
    }
  }`;
  patched = replaceOnce(patched, releaseBlock, cppReleasePatch(), operations, 'owner-release');
  const connectGet = `  // Fetch pty handle from ID and start process
  pty_baton* handle = get_pty_baton(id);
  if (!handle) {
    throw Napi::Error::New(env, "Invalid pty handle");
  }`;
  const connectClaim = `  if (!useConptyDll || info[0].As<Napi::Number>().DoubleValue() != static_cast<double>(id) || id <= 0)
    throw Napi::Error::New(env, "diagnostic connect requires bundled DLL and a positive integer id");
  pty_baton* handle = nullptr;
  HANDLE ownerInput = nullptr;
  HANDLE ownerOutput = nullptr;
  HPCON ownerHpc = nullptr;
  unsigned long long ownerGeneration = 0;
  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    const auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& owner) {
      return owner->id == id;
    });
    if (it == ptyHandles.end()) throw Napi::Error::New(env, "Invalid pty owner");
    handle = it->get();
    if (handle->connectClaimed || handle->closeInFlight || handle->ownerClosed || handle->lifecycleFailed) {
      dsc_record_event_locked(handle, "operation-rejected", false, ERROR_ALREADY_EXISTS);
      throw Napi::Error::New(env, "diagnostic owner connect is one-shot");
    }
    handle->connectClaimed = true;
    ownerInput = handle->hIn;
    ownerOutput = handle->hOut;
    ownerHpc = handle->hpc;
    ownerGeneration = handle->generation;
  }`;
  patched = replaceOnce(patched, connectGet, connectClaim, operations, 'owner-connect-claim');
  patched = replaceOnce(patched, `  ConnectNamedPipe(handle->hIn, nullptr);
  ConnectNamedPipe(handle->hOut, nullptr);`, `  ConnectNamedPipe(ownerInput, nullptr);
  ConnectNamedPipe(ownerOutput, nullptr);`, operations, 'owner-connect-pipe-snapshot');
  patched = replaceOnce(patched, '                                       handle->hpc,',
    '                                       ownerHpc,', operations, 'owner-connect-hpc-snapshot');
  const connectHandles = `  // Update handle
  handle->hShell = piClient.hProcess;

  // Close the thread handle to avoid resource leak
  CloseHandle(piClient.hThread);
  // Close the input read and output write handle of the pseudoconsole
  CloseHandle(handle->hIn);
  CloseHandle(handle->hOut);`;
  patched = replaceOnce(patched, connectHandles, `  {
    std::lock_guard<std::mutex> lock(dsc_pty_mutex);
    handle->hShell = piClient.hProcess;
    handle->pid = piClient.dwProcessId;
    const BOOL threadClosed = CloseHandle(piClient.hThread);
    if (!threadClosed) {
      const DWORD error = GetLastError();
      handle->lifecycleFailed = true;
      dsc_record_event_locked(handle, "operation-rejected", false, error);
    }
    const BOOL inputClosed = CloseHandle(ownerInput);
    if (inputClosed) handle->hIn = nullptr;
    else {
      const DWORD error = GetLastError();
      handle->lifecycleFailed = true;
      dsc_record_event_locked(handle, "operation-rejected", false, error);
    }
    const BOOL outputClosed = CloseHandle(ownerOutput);
    if (outputClosed) handle->hOut = nullptr;
    else {
      const DWORD error = GetLastError();
      handle->lifecycleFailed = true;
      dsc_record_event_locked(handle, "operation-rejected", false, error);
    }
  }`, operations, 'owner-connect-handles');
  const connectReturn = `  marshal.Set("pid", Napi::Number::New(env, piClient.dwProcessId));
  return marshal;`;
  patched = replaceOnce(patched, connectReturn,
    `  marshal.Set("pid", Napi::Number::New(env, piClient.dwProcessId));
  marshal.Set("generation", std::to_string(ownerGeneration));
  return marshal;`, operations, 'owner-connect-result');
  const resizeStart = patched.indexOf('static Napi::Value PtyResize(');
  const clearStart = patched.indexOf('static Napi::Value PtyClear(', resizeStart);
  const killStartAfterApi = patched.indexOf(KILL_ANCHOR, clearStart);
  const initStart = patched.indexOf('/**\n* Init', killStartAfterApi);
  assert(resizeStart >= 0 && clearStart > resizeStart && killStartAfterApi > clearStart && initStart > killStartAfterApi,
    'missing legacy mutation API blocks');
  patched = replaceOnce(patched, patched.slice(resizeStart, clearStart),
    cppDisabledPtyApi('PtyResize') + '\n\n', operations, 'owner-disable-resize');
  const clearStartAfterResize = patched.indexOf('static Napi::Value PtyClear(');
  const killStartAfterResize = patched.indexOf(KILL_ANCHOR, clearStartAfterResize);
  patched = replaceOnce(patched, patched.slice(clearStartAfterResize, killStartAfterResize),
    cppDisabledPtyApi('PtyClear') + '\n\n', operations, 'owner-disable-clear');
  const killStartFinal = patched.indexOf(KILL_ANCHOR);
  const initStartFinal = patched.indexOf('/**\n* Init', killStartFinal);
  patched = replaceOnce(patched, patched.slice(killStartFinal, initStartFinal),
    cppDisabledPtyApi('PtyKill') + '\n\n', operations, 'owner-disable-kill');
  patched = replaceOnce(patched, '  exports.Set("resize", Napi::Function::New(env, PtyResize));\n', '', operations, 'owner-disable-resize-export');
  patched = replaceOnce(patched, '  exports.Set("clear", Napi::Function::New(env, PtyClear));\n', '', operations, 'owner-disable-clear-export');
  patched = replaceOnce(patched, '  exports.Set("kill", Napi::Function::New(env, PtyKill));\n', '', operations, 'owner-disable-kill-export');
  patched = replaceOnce(patched, INIT_ANCHOR, cppOwnerApiPatch() + '\n' + INIT_ANCHOR, operations, 'owner-api');
  patched = insertAfter(patched, INIT_ANCHOR, '\n' + cppExportPatch(), operations, 'owner-exports');
  assert.equal((patched.match(new RegExp(MARKER, 'g')) ?? []).length, 1, 'owner patch marker count mismatch');
  const patch = renderPatch(operations);
  return {
    schema: PATCH_SCHEMA,
    source: patched,
    sourceHash,
    patchedSourceHash: sha256(patched),
    inputPath: SOURCE_RELATIVE_PATH,
    patch,
    patchHash: sha256(patch),
    operations: operations.map(({ label, line, before, after }) => ({ label, line, before, after })),
    api: API_SCHEMA,
  };
}

export function patchConptyOwnerFile(sourcePath = resolveSourcePath(), headerPath = path.join(path.dirname(sourcePath), 'conpty.h')) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const headerHash = verifyHeader(fs.readFileSync(headerPath, 'utf8'));
  return { ...patchConptyOwnerSource(source), headerHash };
}

function testOwnerGateModel() {
  // This is a contract model, not a substitute for the Windows native acceptance run.
  const owner = { id: 1, generation: '1', lifecycleFailed: false, closeInvoked: false,
    ...Object.fromEntries(API_SCHEMA.gate.map(gate => [gate, false])) };
  let present = true;
  let invocations = 0;
  const get = (id, generation) => present && id === owner.id && generation === owner.generation ? owner : null;
  const close = (id, generation, useConptyDll = true) => {
    if (!useConptyDll) return 'dll-backend-required';
    const entry = get(id, generation);
    if (!entry) return 'unknown-owner';
    if (entry.lifecycleFailed || API_SCHEMA.gate.some(gate => !entry[gate])) return 'close-before-gates';
    if (entry.closeInvoked) return 'duplicate-close';
    entry.closeInvoked = true;
    invocations += 1;
    present = false;
    return 'closed';
  };
  const mark = (id, generation, gate) => {
    const entry = get(id, generation);
    if (!entry) return 'unknown-owner';
    if (entry.lifecycleFailed || (gate === 'consumerComplete' && !entry.pipeEof)) return 'gate-precondition-failed';
    if (entry[gate]) return 'duplicate-gate';
    entry[gate] = true;
    return 'marked';
  };
  assert.equal(close(2, '1'), 'unknown-owner');
  assert.equal(close(1, '2'), 'unknown-owner');
  assert.equal(close(1, '1', false), 'dll-backend-required');
  assert.equal(close(1, '1'), 'close-before-gates');
  assert.equal(mark(1, '2', 'pipeEof'), 'unknown-owner');
  assert.equal(mark(1, '1', 'consumerComplete'), 'gate-precondition-failed');
  assert.equal(mark(1, '1', 'pipeEof'), 'marked');
  assert.equal(mark(1, '1', 'pipeEof'), 'duplicate-gate');
  for (const gate of API_SCHEMA.gate) {
    for (const key of API_SCHEMA.gate) owner[key] = key !== gate;
    assert.equal(close(1, '1'), 'close-before-gates', gate);
  }
  for (const gate of API_SCHEMA.gate) owner[gate] = true;
  owner.lifecycleFailed = true;
  assert.equal(close(1, '1'), 'close-before-gates');
  owner.lifecycleFailed = false;
  owner.closeInvoked = true;
  assert.equal(close(1, '1'), 'duplicate-close');
  owner.closeInvoked = false;
  assert.equal(invocations, 0);
  assert.equal(close(1, '1'), 'closed');
  assert.equal(close(1, '1'), 'unknown-owner');
  assert.equal(mark(1, '1', 'consumerComplete'), 'unknown-owner');
  assert.equal(invocations, 1);
}

export function selfTest(sourcePath = resolveSourcePath()) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const header = fs.readFileSync(path.join(path.dirname(sourcePath), 'conpty.h'), 'utf8');
  verifyHeader(header);
  assert.throws(() => verifyHeader(header.replace('HRESULT WINAPI ConptyReleasePseudoConsole', 'VOID WINAPI ConptyReleasePseudoConsole')),
    /unexpected conpty.h SHA256/);
  const first = patchConptyOwnerSource(source);
  const second = patchConptyOwnerSource(source);
  assert.equal(first.source, second.source, 'patch output is not deterministic');
  assert.equal(first.patch, second.patch, 'patch diff is not deterministic');
  assert.equal(first.patchedSourceHash, second.patchedSourceHash);
  assert.deepEqual(first.operations.map(operation => operation.label), [
    'owner-includes', 'owner-lock', 'owner-baton', 'owner-state',
    'owner-remove-legacy-get', 'owner-remove-legacy-remove', 'owner-create', 'owner-start-dll-only',
    'owner-exit-callback', 'owner-release', 'owner-connect-claim',
    'owner-connect-pipe-snapshot', 'owner-connect-hpc-snapshot', 'owner-connect-handles', 'owner-connect-result',
    'owner-disable-resize', 'owner-disable-clear', 'owner-disable-kill',
    'owner-disable-resize-export', 'owner-disable-clear-export', 'owner-disable-kill-export', 'owner-api', 'owner-exports',
  ]);
  assert.equal((first.source.match(new RegExp(MARKER, 'g')) ?? []).length, 1);
  assert.equal((first.source.match(/struct ExitEvent \{/g) ?? []).length, 1);
  for (const api of ['PtyMarkPipeEof', 'PtyMarkConsumerComplete', 'PtyCloseAfterExit', 'PtyOwnerSnapshot']) {
    assert.equal((first.source.match(new RegExp(`static Napi::Value ${api}\\(`, 'g')) ?? []).length, 1, api);
    assert(first.source.includes(`Napi::Function::New(env, ${api})`), `${api} must be exported`);
  }
  for (const forbidden of ['PATCH_SCHEMA', 'TerminateProcess(', 'get_pty_baton(', 'remove_pty_baton(',
    'GetProcAddress(hLibrary,', 'exports.Set("kill"', 'exports.Set("resize"', 'exports.Set("clear"']) {
    assert(!first.source.includes(forbidden), `generated source contains forbidden ${forbidden}`);
  }
  for (const gate of API_SCHEMA.gate) assert(first.source.includes(`!owner->${gate}`), `missing native close gate ${gate}`);
  assert(first.source.includes('handle->connectClaimed = true;'));
  assert(first.source.includes('handle->pid = piClient.dwProcessId;'));
  assert(first.source.includes('if (wait_result != WAIT_OBJECT_0)'));
  assert(first.source.includes('else if (!GetExitCodeProcess(shell, &exit_code))'));
  assert(first.source.includes('if (release_status != napi_ok) baton->lifecycleFailed = true;'));
  assert(first.source.includes('handle->releaseSucceeded = SUCCEEDED(releaseResult);'));
  assert(first.source.includes('reinterpret_cast<decltype(&ConptyReleasePseudoConsole)>'));
  assert.equal((first.source.match(/closeFn\(hpc\);/g) ?? []).length, 1);
  assert(!cppOwnerApiPatch().includes('LoadConptyDll('), 'Close must not add a module reference');
  assert(cppExitEventPatch().indexOf('th->join();') < cppExitEventPatch().indexOf('owner->nativeExitThreadDone = true;'));
  testOwnerGateModel();
  assert.throws(() => patchConptyOwnerSource(first.source), /unexpected conpty\.cc SHA256|already contains/);
  assert.throws(() => patchConptyOwnerSource(source.replace('struct pty_baton {', 'struct pty_baton {\r')), /LF line endings/);
  assert.throws(() => patchConptyOwnerSource(source.replace(EXIT_ANCHOR, 'struct MissingExitEvent {')), /unexpected conpty\.cc SHA256/);
  assert(API_SCHEMA.exports.markPipeEof.includes('generation:string'));
  assert(API_SCHEMA.events.includes('close-returned'));
  assert(API_SCHEMA.forbidden.includes('TerminateProcess'));
  return { ok: true, sourceHash: first.sourceHash, headerHash: HEADER_SHA256, patchedSourceHash: first.patchedSourceHash,
    patchHash: first.patchHash, operations: first.operations.map(operation => operation.label),
    api: API_SCHEMA };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--self-test')) {
    const sourceIndex = process.argv.indexOf('--source');
    console.log(JSON.stringify(selfTest(sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined), null, 2));
  }
  else {
    const result = patchConptyOwnerFile();
    console.log(JSON.stringify({ ...result, source: undefined, patch: undefined }, null, 2));
  }
}
