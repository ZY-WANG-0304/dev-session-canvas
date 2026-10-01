#ifndef DSC_LINUX_EXECUTION_OWNER_H
#define DSC_LINUX_EXECUTION_OWNER_H

#if !defined(__linux__)
#error "The execution owner supports Linux only"
#endif

#include "unix-execution-owner.h"
#include <cstddef>
#include <cstring>
#include <sys/socket.h>
#include <sys/un.h>

namespace dsc_execution {

static int namespaceFd = -1;
static bool NamespaceClaimed() { return namespaceFd >= 0; }

static Napi::Value ClaimNamespace(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsString())
    throw Napi::TypeError::New(info.Env(), "executionClaimNamespace requires an abstract namespace address");
  if (owner.configured || NamespaceClaimed())
    throw Napi::Error::New(info.Env(), "Namespace ownership is authority-only and one-shot");
  const std::string address = info[0].As<Napi::String>().Utf8Value();
  const std::string prefix("\0dsc-runtime-owner-", 19);
  if (address.size() != prefix.size() + 64 || address.compare(0, prefix.size(), prefix) != 0 ||
      address.find_first_not_of("0123456789abcdef", prefix.size()) != std::string::npos)
    throw Napi::TypeError::New(info.Env(), "Invalid abstract namespace address");
  struct sockaddr_un name = {};
  name.sun_family = AF_UNIX;
  std::memcpy(name.sun_path, address.data(), address.size());
  const int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) throw Napi::Error::New(info.Env(), "Cannot create the namespace owner socket");
  // Abstract names include their exact byte length, not a trailing C terminator.
  if (bind(fd, reinterpret_cast<const struct sockaddr*>(&name),
      static_cast<socklen_t>(offsetof(struct sockaddr_un, sun_path) + address.size())) < 0) {
    const int error = errno;
    close(fd);
    throw Napi::Error::New(info.Env(), "Cannot claim the namespace owner socket: " + std::string(std::strerror(error)));
  }
  // No release export or environment cleanup: the original authority retains the claim until exit.
  namespaceFd = fd;
  return info.Env().Undefined();
}

}  // namespace dsc_execution

#endif
