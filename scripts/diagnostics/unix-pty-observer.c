#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <node_api.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int property(napi_env env, napi_value object, const char *name, napi_value value) {
  return napi_set_named_property(env, object, name, value) == napi_ok;
}
static int integer(napi_env env, napi_value object, const char *name, int value) {
  napi_value result;
  return napi_create_int32(env, value, &result) == napi_ok && property(env, object, name, result);
}
static int boolean(napi_env env, napi_value object, const char *name, int value) {
  napi_value result;
  return napi_get_boolean(env, value != 0, &result) == napi_ok && property(env, object, name, result);
}
static int identity_part(napi_env env, napi_value object, const char *name, uintmax_t value) {
  char buffer[64];
  napi_value result;
  int length = snprintf(buffer, sizeof(buffer), "%" PRIuMAX, value);
  return length > 0 && (size_t)length < sizeof(buffer) &&
    napi_create_string_utf8(env, buffer, (size_t)length, &result) == napi_ok && property(env, object, name, result);
}
static napi_value failure(napi_env env, const char *operation) {
  int saved_errno = errno;
  char message[256];
  (void)snprintf(message, sizeof(message), "%s: errno=%d %s", operation, saved_errno, strerror(saved_errno));
  (void)napi_throw_error(env, "PTY_OBSERVER_SYSCALL", message);
  return NULL;
}
static napi_value observe(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], result, identity;
  int32_t fd;
  double number;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_int32(env, argv[0], &fd) != napi_ok || fd < 0 ||
      napi_get_value_double(env, argv[0], &number) != napi_ok || number != (double)fd) {
    (void)napi_throw_type_error(env, "PTY_OBSERVER_ARGUMENT", "observe requires a nonnegative integer fd");
    return NULL;
  }
  /* Do not duplicate the descriptor or change its shared open-file description. */
  int before = fcntl(fd, F_GETFL);
  if (before == -1) return failure(env, "fcntl before");
  struct stat stat;
  if (fstat(fd, &stat) == -1) return failure(env, "fstat");
  int tty = isatty(fd);
  struct pollfd descriptor = { .fd = fd, .events = POLLIN, .revents = 0 };
  int ready = poll(&descriptor, 1, 0);
  if (ready == -1) return failure(env, "poll");
  int after = fcntl(fd, F_GETFL);
  if (after == -1) return failure(env, "fcntl after");
  if (napi_create_object(env, &result) != napi_ok || napi_create_object(env, &identity) != napi_ok ||
      !integer(env, result, "before", before) || !integer(env, result, "after", after) ||
      !integer(env, result, "nonblockMask", O_NONBLOCK) || !integer(env, result, "readableMask", POLLIN) ||
      !integer(env, result, "invalidMask", POLLERR | POLLHUP | POLLNVAL) ||
      !integer(env, result, "revents", descriptor.revents) || !integer(env, result, "ready", ready) ||
      !boolean(env, result, "tty", tty) || !identity_part(env, identity, "dev", (uintmax_t)stat.st_dev) ||
      !identity_part(env, identity, "ino", (uintmax_t)stat.st_ino) ||
      !identity_part(env, identity, "rdev", (uintmax_t)stat.st_rdev) || !property(env, result, "identity", identity)) {
    (void)napi_throw_error(env, "PTY_OBSERVER_NAPI", "Unable to construct observation");
    return NULL;
  }
  return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "observe", NAPI_AUTO_LENGTH, observe, NULL, &function) != napi_ok ||
      !property(env, exports, "observe", function)) {
    (void)napi_throw_error(env, "PTY_OBSERVER_NAPI", "Unable to initialize observer");
    return NULL;
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
