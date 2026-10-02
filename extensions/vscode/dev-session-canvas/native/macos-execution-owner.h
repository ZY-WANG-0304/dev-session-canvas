#ifndef DSC_MACOS_EXECUTION_OWNER_H
#define DSC_MACOS_EXECUTION_OWNER_H

#if !defined(__APPLE__)
#error "The macOS execution owner requires Darwin"
#endif

#include <cstdlib>
#include <fcntl.h>
#include <limits.h>
#include <spawn.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <termios.h>

#include "unix-execution-owner.h"

namespace dsc_execution {

struct CreationResource {
  const char* id;
  int value = -1;
  bool acquired = false;
  bool releaseAttempted = false;
  int releaseResult = -1;
  int releaseError = 0;
};

static CreationResource creationResources[] = {
  {"pty-low-fd-0"}, {"pty-low-fd-1"}, {"pty-low-fd-2"},
  {"pty-spawn-actions"}, {"pty-spawn-attrs"}, {"pty-slave"}
};
static int namespaceFd = -1;

static bool NamespaceClaimed() { return namespaceFd >= 0; }

static void AppendCreationResources(Napi::Env env, Napi::Object result) {
  Napi::Array resources = Napi::Array::New(env);
  uint32_t index = 0;
  for (const CreationResource& resource : creationResources) {
    if (!resource.acquired) continue;
    Napi::Object item = Napi::Object::New(env);
    item.Set("resourceId", resource.id);
    item.Set("acquired", true);
    item.Set("releaseAttempted", resource.releaseAttempted);
    item.Set("releaseResult", MaybeNumber(env, resource.releaseAttempted, resource.releaseResult));
    item.Set("releaseErrno", MaybeNumber(env, resource.releaseError != 0, resource.releaseError));
    resources.Set(index++, item);
  }
  result.Set("creationResources", resources);
}

static void Acquired(size_t index, int value) {
  creationResources[index].value = value;
  creationResources[index].acquired = true;
}

static void Released(size_t index, int result, int error) {
  CreationResource& resource = creationResources[index];
  resource.releaseAttempted = true;
  resource.releaseResult = result;
  resource.releaseError = error;
}

static void CloseCreationFd(size_t index) {
  CreationResource& resource = creationResources[index];
  if (!resource.acquired || resource.releaseAttempted) return;
  errno = 0;
  const int result = close(resource.value);
  Released(index, result, result < 0 ? errno : 0);
}

static void BeforeSpawn(Napi::Env env, const std::string& helper) {
  if (helper.empty() || helper[0] != '/' || helper.find('\0') != std::string::npos)
    throw Napi::Error::New(env, "An absolute verified spawn helper is required");
  BeforeFork(env);
}

static void Spawn(char** argv, char** env, const struct termios* term,
                  const struct winsize* size, int* master, pid_t* pid, std::string* error) {
  *master = -1;
  *pid = -1;
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attributes;
  const int failure = [&]() -> int {
    for (size_t index = 0; index < 3; ++index) {
      const int fd = posix_openpt(O_RDWR);
      if (fd < 0) return errno;
      Acquired(index, fd);
      if (fd >= STDERR_FILENO) break;
    }
    int result = posix_spawn_file_actions_init(&actions);
    if (result != 0) return result;
    Acquired(3, 0);
    result = posix_spawnattr_init(&attributes);
    if (result != 0) return result;
    Acquired(4, 0);

    *master = posix_openpt(O_RDWR);
    if (*master < 0) return errno;
    owner.master = *master;
    owner.masterAcquired = true;
    if (grantpt(*master) < 0 || unlockpt(*master) < 0) return errno;
    char slavePath[128] = {};
    if (ioctl(*master, TIOCPTYGNAME, slavePath) < 0) return errno;
    const int slave = open(slavePath, O_RDWR | O_NOCTTY);
    if (slave < 0) return errno;
    Acquired(5, slave);
    if (term && tcsetattr(slave, TCSANOW, term) < 0) return errno;
    if (size && ioctl(slave, TIOCSWINSZ, size) < 0) return errno;
    for (int target = STDIN_FILENO; target <= STDERR_FILENO; ++target) {
      result = posix_spawn_file_actions_adddup2(&actions, slave, target);
      if (result != 0) return result;
    }
    result = posix_spawn_file_actions_addclose(&actions, slave);
    if (result != 0) return result;
    result = posix_spawn_file_actions_addclose(&actions, *master);
    if (result != 0) return result;
    // The verified helper creates the session without the macOS 10.15-only spawn flag.
    result = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT |
      POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK);
    if (result != 0) return result;
    sigset_t signals;
    if (sigfillset(&signals) < 0) return errno;
    result = posix_spawnattr_setsigdefault(&attributes, &signals);
    if (result != 0) return result;
    if (sigemptyset(&signals) < 0) return errno;
    result = posix_spawnattr_setsigmask(&attributes, &signals);
    if (result != 0) return result;
    result = posix_spawn(pid, argv[0], &actions, &attributes, argv, env);
    if (result != 0) return result;
    owner.pid = *pid;
    owner.childAcquired = true;
    owner.waitKind = "pending";
    return 0;
  }();

  if (creationResources[3].acquired) {
    const int result = posix_spawn_file_actions_destroy(&actions);
    Released(3, result == 0 ? 0 : -1, result);
  }
  if (creationResources[4].acquired) {
    const int result = posix_spawnattr_destroy(&attributes);
    Released(4, result == 0 ? 0 : -1, result);
  }
  CloseCreationFd(5);
  for (size_t index = 0; index < 3; ++index) CloseCreationFd(index);
  owner.forkError = failure;
  if (failure != 0) *error = "Darwin PTY creation failed with code " + std::to_string(failure);
  for (const CreationResource& resource : creationResources) {
    if (resource.acquired && (!resource.releaseAttempted || resource.releaseResult != 0) && error->empty())
      *error = "Darwin PTY creation resource release is unconfirmed";
  }
}

static bool SameFile(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino;
}

static bool ValidNamespaceFile(const struct stat& state) {
  return S_ISREG(state.st_mode) && state.st_uid == geteuid() && state.st_nlink == 1 &&
    (state.st_mode & 07777) == 0600 && state.st_size == 0;
}

static Napi::Value ClaimNamespace(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsString())
    throw Napi::TypeError::New(info.Env(), "executionClaimNamespace requires an absolute lock path");
  if (owner.configured || NamespaceClaimed())
    throw Napi::Error::New(info.Env(), "Namespace ownership is authority-only and one-shot");
  const std::string path = info[0].As<Napi::String>().Utf8Value();
  if (path.empty() || path[0] != '/' || path.back() == '/' || path.find('\0') != std::string::npos)
    throw Napi::TypeError::New(info.Env(), "Invalid namespace lock path");
  const std::string parent = path.substr(0, path.find_last_of('/'));
  char canonical[PATH_MAX];
  struct stat directory = {};
  if (parent.empty() || !realpath(parent.c_str(), canonical) || parent != canonical ||
      lstat(parent.c_str(), &directory) < 0 || !S_ISDIR(directory.st_mode) ||
      directory.st_uid != geteuid() || (directory.st_mode & 07777) != 0700)
    throw Napi::Error::New(info.Env(), "Namespace storage must be a canonical private owner directory");
  const int fd = open(path.c_str(), O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) throw Napi::Error::New(info.Env(), "Cannot open the namespace owner file");
  struct stat opened = {}, current = {};
  const bool valid = fstat(fd, &opened) == 0 && ValidNamespaceFile(opened) &&
    lstat(path.c_str(), &current) == 0 && SameFile(opened, current) &&
    flock(fd, LOCK_EX | LOCK_NB) == 0 &&
    lstat(path.c_str(), &current) == 0 && ValidNamespaceFile(current) && SameFile(opened, current);
  if (!valid) {
    close(fd);
    throw Napi::Error::New(info.Env(), "Namespace owner validation or exclusive claim failed");
  }
  // No exported release or unlink: the original authority retains this claim until exit.
  namespaceFd = fd;
  return info.Env().Undefined();
}

}  // namespace dsc_execution

#endif
