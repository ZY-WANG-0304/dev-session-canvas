import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const explicitGitSha = readFlagValue(args, '--git-sha') ?? process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA;
const gitSha = explicitGitSha ?? (await readGitSha());
const deployArgs = stripFlag(args, '--git-sha');

if (!gitSha) {
  throw new Error('Unable to resolve git sha for marketplace service metadata.');
}

await run('wrangler', ['deploy', ...deployArgs, '--keep-vars', '--var', `MARKETPLACE_GIT_SHA:${gitSha}`]);

function readFlagValue(values, name) {
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value?.startsWith(inlinePrefix)) {
      return value.slice(inlinePrefix.length).trim() || undefined;
    }
    if (value === name) {
      return values[index + 1]?.trim() || undefined;
    }
  }
  return undefined;
}

function stripFlag(values, name) {
  const inlinePrefix = `${name}=`;
  const stripped = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === name) {
      index += 1;
      continue;
    }
    if (value?.startsWith(inlinePrefix)) {
      continue;
    }
    stripped.push(value);
  }
  return stripped;
}

async function readGitSha() {
  const result = await run('git', ['rev-parse', 'HEAD'], { capture: true, check: false });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function run(command, commandArgs, options = {}) {
  const capture = options.capture === true;
  const check = options.check !== false;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === 'win32',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    const stdout = [];
    const stderr = [];
    if (capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.on('error', reject);
    child.on('close', (status) => {
      const result = {
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      };
      if (check && result.status !== 0) {
        reject(new Error(`${command} ${commandArgs.join(' ')} failed with status ${result.status}`));
        return;
      }
      resolve(result);
    });
  });
}
