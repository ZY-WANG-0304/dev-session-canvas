#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <node_api.h>
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
  const int length = snprintf(buffer, sizeof(buffer), "%" PRIuMAX, value);
  return length > 0 && (size_t)length < sizeof(buffer) &&
    napi_create_string_utf8(env, buffer, (size_t)length, &result) == napi_ok &&
    property(env, object, name, result);
}

static napi_value syscall_failure(napi_env env, const char *operation) {
  const int saved_errno = errno;
  char message[256];
  (void)snprintf(message, sizeof(message), "%s: errno=%d %s", operation, saved_errno, strerror(saved_errno));
  (void)napi_throw_error(env, "FD_INSPECT_SYSCALL", message);
  return NULL;
}

static napi_value inspect(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], result, identity;
  int32_t fd;
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_typeof(env, argv[0], &type) != napi_ok || type != napi_number ||
      napi_get_value_int32(env, argv[0], &fd) != napi_ok || fd < 0) {
    (void)napi_throw_type_error(env, "FD_INSPECT_ARGUMENT", "inspect requires a nonnegative integer fd");
    return NULL;
  }
  double number;
  if (napi_get_value_double(env, argv[0], &number) != napi_ok || number != (double)fd) {
    (void)napi_throw_type_error(env, "FD_INSPECT_ARGUMENT", "inspect requires a nonnegative integer fd");
    return NULL;
  }

  /* Observe the caller's existing descriptor; never duplicate or change its open-file description. */
  const int flags = fcntl(fd, F_GETFL);
  if (flags == -1) return syscall_failure(env, "fcntl(F_GETFL)");
  struct stat stat;
  if (fstat(fd, &stat) == -1) return syscall_failure(env, "fstat");
  const int tty = isatty(fd);
  if (napi_create_object(env, &result) != napi_ok || napi_create_object(env, &identity) != napi_ok ||
      !integer(env, result, "flags", flags) || !boolean(env, result, "nonblocking", flags & O_NONBLOCK) ||
      !boolean(env, result, "tty", tty) || !identity_part(env, identity, "dev", (uintmax_t)stat.st_dev) ||
      !identity_part(env, identity, "ino", (uintmax_t)stat.st_ino) ||
      !identity_part(env, identity, "rdev", (uintmax_t)stat.st_rdev) || !property(env, result, "identity", identity)) {
    (void)napi_throw_error(env, "FD_INSPECT_NAPI", "Unable to construct fd inspection result");
    return NULL;
  }
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "inspect", NAPI_AUTO_LENGTH, inspect, NULL, &function) != napi_ok ||
      !property(env, exports, "inspect", function) || !integer(env, exports, "nonblockMask", O_NONBLOCK)) {
    (void)napi_throw_error(env, "FD_INSPECT_NAPI", "Unable to initialize fd inspector");
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
