const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const FAKE_SYSTEMD_MODE = process.env.DEV_SESSION_CANVAS_FAKE_SYSTEMD_MODE || 'success';
const STATE_DIR =
  process.env.DEV_SESSION_CANVAS_FAKE_SYSTEMD_STATE_DIR ||
  path.join(os.tmpdir(), 'dev-session-canvas-fake-systemd');

async function main() {
  const args = process.argv.slice(2);
  const normalizedArgs = args[0] === '--user' ? args.slice(1) : args;
  const [command, target] = normalizedArgs;

  await fs.promises.mkdir(STATE_DIR, { recursive: true });
  await appendLog({
    args,
    normalizedArgs,
    mode: FAKE_SYSTEMD_MODE,
    timestamp: new Date().toISOString()
  });

  switch (command) {
    case 'daemon-reload':
      process.exitCode = 0;
      return;
    case 'start':
      if (!target) {
        throw new Error('fake systemctl start 缺少 unit 名称。');
      }
      await handleStart(target);
      process.exitCode = 0;
      return;
    default:
      throw new Error(`fake systemctl 不支持命令：${normalizedArgs.join(' ')}`);
  }
}

async function handleStart(unitName) {
  if (FAKE_SYSTEMD_MODE === 'fail-start') {
    throw new Error(`fake systemctl 配置为失败模式，拒绝启动 ${unitName}。`);
  }

  const unitFilePath = resolveUnitFilePath(unitName);
  const unitContent = await fs.promises.readFile(unitFilePath, 'utf8');
  const execStartLine = unitContent
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('ExecStart='));
  if (!execStartLine) {
    throw new Error(`fake systemctl 未找到 ${unitName} 的 ExecStart。`);
  }

  const workingDirectoryLine = unitContent
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('WorkingDirectory='));
  const workingDirectory = workingDirectoryLine
    ? parseQuotedValue(workingDirectoryLine.slice('WorkingDirectory='.length))
    : process.cwd();
  const environment = parseUnitEnvironment(unitContent);
  const execArgs = parseQuotedArgList(execStartLine.slice('ExecStart='.length));
  await appendLog({
    unitName,
    unitFilePath,
    workingDirectory,
    environment,
    execArgs,
    timestamp: new Date().toISOString()
  });
  if (execArgs.length === 0) {
    throw new Error(`fake systemctl 解析 ${unitName} 的 ExecStart 结果为空。`);
  }

  const stateFilePath = path.join(STATE_DIR, `${unitName}.json`);
  const existingPid = await readExistingPid(stateFilePath);
  if (existingPid && isProcessAlive(existingPid)) {
    return;
  }

  const [file, ...args] = execArgs;
  const child = spawn(file, args, {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ...environment
    }
  });
  child.unref();

  await fs.promises.writeFile(
    stateFilePath,
    `${JSON.stringify({ unitName, pid: child.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  await appendLog({
    unitName,
    pid: child.pid,
    stateFilePath,
    timestamp: new Date().toISOString()
  });
}

function resolveUnitFilePath(unitName) {
  if (path.isAbsolute(unitName)) {
    return unitName;
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || os.homedir(), '.config');
  return path.join(configHome, 'systemd', 'user', unitName);
}

async function readExistingPid(stateFilePath) {
  try {
    const raw = await fs.promises.readFile(stateFilePath, 'utf8');
    const payload = JSON.parse(raw);
    return typeof payload.pid === 'number' ? payload.pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseQuotedValue(value) {
  const [parsedValue] = parseQuotedArgList(value);
  return parsedValue || value.trim();
}

function parseQuotedArgList(value) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function parseUnitEnvironment(unitContent) {
  const environment = {};
  const lines = unitContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Environment='));

  for (const line of lines) {
    const assignments = parseQuotedArgList(line.slice('Environment='.length));
    for (const assignment of assignments) {
      const separatorIndex = assignment.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = assignment.slice(0, separatorIndex);
      const value = assignment.slice(separatorIndex + 1);
      environment[key] = value;
    }
  }

  return environment;
}

async function appendLog(payload) {
  await fs.promises.appendFile(
    path.join(STATE_DIR, 'systemctl.log'),
    `${JSON.stringify(payload)}\n`,
    'utf8'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
