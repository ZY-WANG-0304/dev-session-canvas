import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchMacosSpawnHelper } from '../build/macos-execution-provider-patch.mjs';

assert(['linux', 'darwin'].includes(process.platform), 'This controlled helper test requires a POSIX C++ compiler.');
const baseline = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
const upstream = fs.readFileSync('node_modules/node-pty/src/unix/spawn-helper.cc', 'utf8');
let helper = patchMacosSpawnHelper(upstream);
if (baseline) {
  const builder = spawnSync('git', ['show', `${baseline}:scripts/build/macos-execution-candidate-assets.mjs`], { encoding: 'utf8' });
  assert.equal(builder.status, 0);
  assert(builder.stdout.includes('fs.writeFileSync(helperInput, helperSource, { flag: \'wx\' });'),
    'Only the recorded unpatched-helper baseline is supported.');
  helper = upstream;
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-helper-'));
try {
  fs.writeFileSync(path.join(directory, 'helper.cc'), helper);
  fs.writeFileSync(path.join(directory, 'test.cc'), `
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>
struct Exit { int code; };
struct Executed {};
static std::string failure;
static std::vector<std::string> calls;
static pid_t test_setsid() { calls.push_back("setsid"); return failure == "setsid" ? -1 : 100; }
static char* test_ttyname(int fd) {
  if (fd != STDIN_FILENO) throw std::runtime_error("wrong tty descriptor");
  calls.push_back("ttyname"); static char tty[] = "/dev/controlled-slave";
  return failure == "ttyname" ? nullptr : tty;
}
static int test_open(const char* name, int flags, ...) {
  if (!name || std::string(name) != "/dev/controlled-slave" || flags != O_RDWR)
    throw std::runtime_error("wrong controlling terminal open");
  calls.push_back("open"); return failure == "open" ? -1 : 7;
}
static int test_close(int fd) {
  if (fd != 7) throw std::runtime_error("wrong temporary descriptor");
  calls.push_back("close"); return failure == "close" ? -1 : 0;
}
static int test_chdir(const char* dir) {
  if (std::string(dir) != "/working") throw std::runtime_error("wrong cwd");
  calls.push_back("chdir"); return failure == "chdir" ? -1 : 0;
}
static int test_execvp(const char* file, char* const argv[]) {
  if (std::string(file) != "/actual-cli" || std::string(argv[0]) != file ||
      std::string(argv[1]) != "original-argument" || argv[2] != nullptr)
    throw std::runtime_error("CLI argv changed");
  calls.push_back("execvp");
  if (failure == "execvp") return -1;
  throw Executed{};
}
[[noreturn]] static void test_exit(int code) { throw Exit{code}; }
#define setsid test_setsid
#define ttyname test_ttyname
#define open test_open
#define close test_close
#define chdir test_chdir
#define execvp test_execvp
#define _exit test_exit
#define main actual_helper_main
#include "helper.cc"
#undef main
int main() {
  const std::vector<std::string> order = {"setsid", "ttyname", "open", "close", "chdir", "execvp"};
  char executable[] = "/helper", cwd[] = "/working", cli[] = "/actual-cli", arg[] = "original-argument";
  char* argv[] = {executable, cwd, cli, arg, nullptr};
  try {
    for (const std::string& scenario : {"arguments", "setsid", "ttyname", "open", "close", "chdir", "execvp", "success"}) {
      failure = scenario; calls.clear(); bool executed = false; int status = -1;
      try { status = actual_helper_main(scenario == "arguments" ? 1 : 4, argv); }
      catch (const Exit& result) { status = result.code; }
      catch (const Executed&) { executed = true; }
      size_t expected = 0;
      if (scenario != "arguments") {
        expected = order.size();
        for (size_t index = 0; index < order.size(); ++index)
          if (scenario == order[index]) expected = index + 1;
      }
      if (calls != std::vector<std::string>(order.begin(), order.begin() + expected))
        throw std::runtime_error("operation ordering mismatch: " + scenario);
      if (executed != (scenario == "success") || (!executed && status != 1))
        throw std::runtime_error("failed setup must not exec: " + scenario);
    }
  } catch (const std::exception& error) { std::fprintf(stderr, "%s\\n", error.what()); return 1; }
  std::puts("8 controlled helper setup/exec cases passed; no native PTY or macOS claim.");
}
`);
  const binary = path.join(directory, 'helper-test');
  const build = spawnSync('c++', ['-std=c++17', path.join(directory, 'test.cc'), '-o', binary],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  console.log(result.stdout.trim());
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
