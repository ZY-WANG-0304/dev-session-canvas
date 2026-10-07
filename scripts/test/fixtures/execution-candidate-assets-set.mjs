import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256 } from '../../build/linux-execution-provider-patch.mjs';
import { MACOS_EXECUTION_EXPORTS, NODE_PTY_SPAWN_HELPER_SHA256 } from '../../build/macos-execution-provider-patch.mjs';
import { WINDOWS_EXECUTION_EXPORTS, NODE_PTY_CONPTY_SHA256 } from '../../build/windows-execution-provider-patch.mjs';
import { NODE_PTY_PATH_UTIL_SHA256, NODE_PTY_WINDOWS_HEADERS_SHA256,
  NODE_GYP_DELAY_LOAD_HOOK_SHA256 } from '../../build/windows-execution-candidate-assets.mjs';
import { readLinuxExecutionRequirements } from '../../build/linux-execution-elf.mjs';
import { linuxExecutionElf } from './linux-execution-elf.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileDigest = relative => digest(fs.readFileSync(path.join(root, relative)));

// These structural fixtures are not loadable native images.
function machO(arch, filetype) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(filetype, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x32, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.writeUInt32LE(1, 40);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x000b0000 : 0x000a0d00, 44);
  return bytes;
}

function pe(arch, dll) {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 68);
  bytes.writeUInt16LE(112, 84);
  bytes.writeUInt16LE(0x0002 | (dll ? 0x2000 : 0), 86);
  bytes.writeUInt16LE(0x20b, 88);
  return bytes;
}

function fixture(platform, arch) {
  const owner = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform];
  const binary = platform === 'linux' ? linuxExecutionElf(arch)
    : platform === 'darwin' ? machO(arch, 8) : pe(arch, true);
  const binaryFile = platform === 'win32' ? 'conpty.node' : 'execution-owner.node';
  const files = new Map([[binaryFile, binary]]);
  const manifest = { schemaVersion: 2, profile: `${owner}-owner-v1-candidate`, platform, arch,
    runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
    binary: { file: binaryFile, sha256: digest(binary) },
    sources: { ownerSha256: fileDigest(`extensions/vscode/dev-session-canvas/native/${owner}-execution-owner.h`),
      patchSha256: fileDigest(`scripts/build/${owner}-execution-provider-patch.mjs`),
      patchedSha256: '1'.repeat(64), headersSha256: '2'.repeat(64), nodeAddonApiSha256: '3'.repeat(64) },
    verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
  if (platform === 'win32') {
    manifest.requirements = { napi: 8,
      windows: { minimumBuild: 17763, conptyVersion: '1.25.260303002', addonCrt: 'static' } };
    manifest.exports = [...WINDOWS_EXECUTION_EXPORTS];
    manifest.dependencies = ['conpty/conpty.dll', 'conpty/OpenConsole.exe'].map((file, index) => {
      const bytes = pe(arch, index === 0);
      files.set(file, bytes);
      return { file, sha256: digest(bytes) };
    });
    Object.assign(manifest.sources, { nodePtySha256: NODE_PTY_CONPTY_SHA256,
      pathUtilSha256: NODE_PTY_PATH_UTIL_SHA256, windowsHeadersSha256: NODE_PTY_WINDOWS_HEADERS_SHA256,
      nodeLibSha256: '4'.repeat(64), delayLoadHookSha256: NODE_GYP_DELAY_LOAD_HOOK_SHA256 });
  } else {
    Object.assign(manifest.sources, { nodePtySha256: NODE_PTY_UNIX_SHA256,
      sharedOwnerSha256: fileDigest('extensions/vscode/dev-session-canvas/native/unix-execution-owner.h') });
    if (platform === 'linux') {
      manifest.requirements = readLinuxExecutionRequirements(binary, arch);
      manifest.libc = { name: 'glibc', version: '2.35' };
      manifest.exports = [...LINUX_EXECUTION_EXPORTS];
    } else {
      manifest.requirements = { napi: 8, macos: { deploymentTarget: arch === 'arm64' ? '11.0' : '10.13' } };
      manifest.exports = [...MACOS_EXECUTION_EXPORTS];
      const helper = machO(arch, 2);
      manifest.helper = { file: 'spawn-helper', sha256: digest(helper) };
      files.set('spawn-helper', helper);
      Object.assign(manifest.sources, { helperSourceSha256: NODE_PTY_SPAWN_HELPER_SHA256,
        helperPatchedSha256: '4'.repeat(64) });
    }
  }
  return { manifest, files };
}

export function writeExecutionAssetSet(directory) {
  fs.mkdirSync(directory);
  const targets = [];
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      const name = `${platform}-${arch}${platform === 'linux' ? '-glibc' : ''}`;
      const target = path.join(directory, name);
      const value = fixture(platform, arch);
      fs.mkdirSync(target);
      for (const [file, bytes] of value.files) {
        const output = path.join(target, file);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, bytes);
        if (file === 'spawn-helper') fs.chmodSync(output, 0o755);
      }
      fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(value.manifest));
      targets.push({ name, directory: target, ...value });
    }
  }
  return targets;
}
