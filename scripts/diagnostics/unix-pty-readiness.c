#include <errno.h>
#include <inttypes.h>
#include <poll.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

static int failure(const char *operation) {
  const int saved_errno = errno;
  printf("{\"version\":1,\"pid\":%ld,\"failure\":\"%s\",\"errno\":%d}\n",
         (long)getpid(), operation, saved_errno);
  return 1;
}

int main(void) {
  struct stat identity;
  struct pollfd descriptor = { .fd = STDIN_FILENO, .events = POLLIN, .revents = 0 };
  if (fstat(STDIN_FILENO, &identity) == -1) return failure("fstat");
  const int tty = isatty(STDIN_FILENO);
  const int ready = poll(&descriptor, 1, 0);
  if (ready == -1) return failure("poll");

  /* Observe only: the owning driver performs every read after this process exits. */
  printf("{\"version\":1,\"pid\":%ld,\"tty\":%s,\"readable\":%s,"
         "\"hup\":%s,\"error\":%s,\"invalid\":%s,\"revents\":%d,"
         "\"identity\":{\"dev\":\"%" PRIuMAX "\",\"ino\":\"%" PRIuMAX
         "\",\"rdev\":\"%" PRIuMAX "\"}}\n",
         (long)getpid(), tty ? "true" : "false",
         descriptor.revents & POLLIN ? "true" : "false",
         descriptor.revents & POLLHUP ? "true" : "false",
         descriptor.revents & POLLERR ? "true" : "false",
         descriptor.revents & POLLNVAL ? "true" : "false",
         (int)descriptor.revents, (uintmax_t)identity.st_dev,
         (uintmax_t)identity.st_ino, (uintmax_t)identity.st_rdev);
  return 0;
}
