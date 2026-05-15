import net from 'net';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { promises as fs } from 'fs';

const SSH_PATH = process.env.DEV_SESSION_CANVAS_TEST_SSH_PATH || 'ssh';
const SSHD_PATH = process.env.DEV_SESSION_CANVAS_TEST_SSHD_PATH || 'sshd';
const SSH_KEYGEN_PATH = process.env.DEV_SESSION_CANVAS_TEST_SSH_KEYGEN_PATH || 'ssh-keygen';
const SELF_SSH_PROBE_OUTPUT = 'SELF_SSHD_OK';

export async function createRemoteSSHFixture(options) {
  if (process.platform !== 'linux') {
    throw new Error('Remote-SSH smoke 夹具当前仅在 Linux 上实现。');
  }

  const fixtureRoot = path.join(options.debugRoot, 'remote-ssh-fixture');
  const sshdRoot = path.join(fixtureRoot, 'sshd');
  const remoteHomeDir = path.join(fixtureRoot, 'remote-home');
  const remoteConfigDir = path.join(fixtureRoot, 'remote-config');
  const remoteCacheDir = path.join(fixtureRoot, 'remote-cache');
  const remoteDataDir = path.join(fixtureRoot, 'remote-data');
  const remoteTmpDir = path.join(fixtureRoot, 'remote-tmp');
  const remoteAgentDir = path.join(fixtureRoot, 'remote-agent');
  const remoteRuntimeDir = path.join(
    os.tmpdir(),
    options.remoteRuntimeDirName ?? `dsc-remote-ssh-runtime-${process.pid}`
  );
  const hostAlias = options.hostAlias ?? 'dsc-remote-smoke';
  const hostKeyPath = path.join(sshdRoot, 'ssh_host_ed25519_key');
  const clientKeyPath = path.join(sshdRoot, 'id_ed25519');
  const authorizedKeysPath = path.join(sshdRoot, 'authorized_keys');
  const sshdConfigPath = path.join(sshdRoot, 'sshd_config');
  const sshConfigPath = path.join(sshdRoot, 'ssh_config');
  const knownHostsPath = path.join(sshdRoot, 'known_hosts');
  const pidFilePath = path.join(sshdRoot, 'sshd.pid');
  const logPath = path.join(sshdRoot, 'sshd.log');
  const port = await reserveTcpPort();
  const username = options.username ?? os.userInfo().username;
  const sshPath = resolveExecutablePath(SSH_PATH);
  const sshdPath = resolveExecutablePath(SSHD_PATH, { requireAbsolute: true });
  const sshKeygenPath = resolveExecutablePath(SSH_KEYGEN_PATH);

  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.mkdir(sshdRoot, { recursive: true, mode: 0o700 });
  await ensurePrivateDir(remoteHomeDir);
  await ensurePrivateDir(remoteConfigDir);
  await ensurePrivateDir(remoteCacheDir);
  await ensurePrivateDir(remoteDataDir);
  await ensurePrivateDir(remoteTmpDir);
  await ensurePrivateDir(remoteAgentDir);
  await fs.rm(remoteRuntimeDir, { recursive: true, force: true });
  await ensurePrivateDir(remoteRuntimeDir);

  generateEd25519Key(sshKeygenPath, hostKeyPath, 'dsc-remote-smoke-host');
  generateEd25519Key(sshKeygenPath, clientKeyPath, 'dsc-remote-smoke-client');
  await fs.writeFile(
    authorizedKeysPath,
    await fs.readFile(`${clientKeyPath}.pub`, 'utf8'),
    { mode: 0o600 }
  );
  await fs.writeFile(knownHostsPath, '', 'utf8');

  await fs.writeFile(
    sshdConfigPath,
    buildSshdConfig({
      port,
      username,
      hostKeyPath,
      authorizedKeysPath,
      pidFilePath,
      logPath,
      remoteHomeDir,
      remoteConfigDir,
      remoteCacheDir,
      remoteDataDir,
      remoteRuntimeDir,
      remoteTmpDir,
      remoteAgentDir,
      realReopenControlFile: options.realReopenControlFile
    }),
    'utf8'
  );
  await fs.writeFile(
    sshConfigPath,
    buildSshConfig({
      hostAlias,
      username,
      port,
      clientKeyPath,
      knownHostsPath
    }),
    'utf8'
  );

  const sshdProcess = spawn(sshdPath, ['-D', '-f', sshdConfigPath, '-E', logPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let sshdExited = false;
  let sshdExitError;
  sshdProcess.on('exit', (code, signal) => {
    sshdExited = true;
    if (code === 0 || signal === 'SIGTERM') {
      return;
    }

    sshdExitError = new Error(
      signal
        ? `临时 sshd 被信号 ${signal} 终止。`
        : `临时 sshd 以退出码 ${code ?? 'unknown'} 退出。`
    );
  });

  try {
    await waitForSelfSshProbe({
      sshPath,
      sshConfigPath,
      hostAlias
    });
  } catch (error) {
    await terminateProcess(sshdProcess);
    const sshdLog = await fs.readFile(logPath, 'utf8').catch(() => '');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n\nsshd log:\n${sshdLog}`.trim()
    );
  }

  await fs.writeFile(
    path.join(fixtureRoot, 'fixture-info.json'),
    `${JSON.stringify(
      {
        hostAlias,
        remoteAuthority: `ssh-remote+${hostAlias}`,
        sshConfigPath,
        sshdConfigPath,
        logPath,
        port,
        remoteHomeDir,
        remoteConfigDir,
        remoteCacheDir,
        remoteDataDir,
        remoteRuntimeDir,
        remoteTmpDir,
        remoteAgentDir,
        realReopenControlFile: options.realReopenControlFile
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    hostAlias,
    remoteAuthority: `ssh-remote+${hostAlias}`,
    sshConfigPath,
    sshdConfigPath,
    logPath,
    remoteHomeDir,
    remoteConfigDir,
    remoteCacheDir,
    remoteDataDir,
    remoteRuntimeDir,
    remoteTmpDir,
    remoteAgentDir,
    async dispose() {
      try {
        await cleanupProcessesForPath(remoteAgentDir, {
          excludePids: [process.pid, sshdProcess.pid].filter(Boolean)
        });
      } catch {
        // Keep fixture cleanup best-effort so failure artifacts remain available.
      } finally {
        await terminateProcess(sshdProcess);
      }

      if (sshdExitError) {
        throw sshdExitError;
      }
    }
  };
}

async function ensurePrivateDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
}

function generateEd25519Key(sshKeygenPath, targetPath, comment) {
  runCommand(
    sshKeygenPath,
    ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', targetPath],
    `生成 SSH key 失败：${targetPath}`
  );
}

function buildSshdConfig(options) {
  const envEntries = {
    HOME: options.remoteHomeDir,
    XDG_CONFIG_HOME: options.remoteConfigDir,
    XDG_CACHE_HOME: options.remoteCacheDir,
    XDG_DATA_HOME: options.remoteDataDir,
    XDG_RUNTIME_DIR: options.remoteRuntimeDir,
    TMPDIR: options.remoteTmpDir,
    VSCODE_AGENT_FOLDER: options.remoteAgentDir,
    DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE: options.realReopenControlFile
  };
  const setEnvLines = Object.entries(envEntries)
    .map(([key, value]) => `SetEnv ${key}=${value}`)
    .join('\n');

  return [
    `Port ${options.port}`,
    'AddressFamily inet',
    'ListenAddress 127.0.0.1',
    `HostKey ${options.hostKeyPath}`,
    `PidFile ${options.pidFilePath}`,
    `AuthorizedKeysFile ${options.authorizedKeysPath}`,
    `AllowUsers ${options.username}`,
    'AuthenticationMethods publickey',
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no',
    'UsePAM no',
    'StrictModes no',
    'PermitUserEnvironment no',
    'PermitRootLogin no',
    'AllowTcpForwarding yes',
    'AllowAgentForwarding no',
    'GatewayPorts no',
    'X11Forwarding no',
    'PrintMotd no',
    'PermitTTY yes',
    'AcceptEnv DEV_SESSION_CANVAS_*',
    'Subsystem sftp internal-sftp',
    'LogLevel VERBOSE',
    setEnvLines,
    ''
  ].join('\n');
}

function buildSshConfig(options) {
  return [
    `Host ${options.hostAlias}`,
    '  HostName 127.0.0.1',
    `  User ${options.username}`,
    `  Port ${options.port}`,
    `  IdentityFile ${options.clientKeyPath}`,
    '  IdentitiesOnly yes',
    '  PreferredAuthentications publickey',
    '  BatchMode yes',
    '  PasswordAuthentication no',
    '  KbdInteractiveAuthentication no',
    '  PubkeyAuthentication yes',
    '  ConnectTimeout 5',
    '  StrictHostKeyChecking no',
    `  UserKnownHostsFile ${options.knownHostsPath}`,
    '  GlobalKnownHostsFile /dev/null',
    '  RequestTTY no',
    '  ControlMaster no',
    ''
  ].join('\n');
}

async function reserveTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('无法为临时 sshd 预留端口。'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForSelfSshProbe(options) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const result = spawnSync(
      options.sshPath,
      ['-F', options.sshConfigPath, options.hostAlias, `echo ${SELF_SSH_PROBE_OUTPUT} && pwd`],
      {
        encoding: 'utf8'
      }
    );

    if (result.status === 0 && result.stdout.includes(SELF_SSH_PROBE_OUTPUT)) {
      return;
    }

    await sleep(250);
  }

  throw new Error('临时 sshd 未在超时内通过 self-ssh probe。');
}

async function terminateProcess(child) {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5000)
  ]);

  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function runCommand(file, args, errorMessage) {
  const result = spawnSync(file, args, {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr ? `${errorMessage}\n${stderr}` : errorMessage);
  }
}

async function cleanupProcessesForPath(pathFragment, options = {}) {
  const excludedPids = new Set((options.excludePids ?? []).map((pid) => String(pid)));
  const pids = findProcessesMatching(pathFragment).filter((pid) => !excludedPids.has(pid));
  if (pids.length === 0) {
    return;
  }

  signalProcesses(pids, 'TERM');
  await sleep(1000);

  const remaining = findProcessesMatching(pathFragment).filter((pid) => !excludedPids.has(pid));
  if (remaining.length === 0) {
    return;
  }

  signalProcesses(remaining, 'KILL');
  await sleep(250);
}

function findProcessesMatching(pathFragment) {
  const result = spawnSync('pgrep', ['-f', pathFragment], {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === 1) {
    return [];
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr ? `进程枚举失败。\n${stderr}` : '进程枚举失败。');
  }

  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function signalProcesses(pids, signalName) {
  const result = spawnSync('kill', [`-${signalName}`, ...pids], {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr ? `发送 ${signalName} 失败。\n${stderr}` : `发送 ${signalName} 失败。`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveExecutablePath(command, options = {}) {
  if (path.isAbsolute(command)) {
    return command;
  }

  const result = spawnSync('which', [command], {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`无法解析可执行文件路径：${command}`);
  }

  const resolvedPath = result.stdout.trim().split('\n')[0];
  if (!resolvedPath) {
    throw new Error(`无法解析可执行文件路径：${command}`);
  }

  if (options.requireAbsolute && !path.isAbsolute(resolvedPath)) {
    throw new Error(`可执行文件不是绝对路径：${command}`);
  }

  return resolvedPath;
}
