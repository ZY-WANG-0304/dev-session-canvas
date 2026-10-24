import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const localizationFiles = ['package.nls.json', 'package.nls.zh-cn.json', 'l10n/bundle.l10n.zh-cn.json'];
const forbiddenPrefixes = [
  'apps/', 'packages/', 'src/', 'docs/', '../', '../../../',
  'node_modules/node-pty/binding.gyp', 'node_modules/node-pty/src/',
  'node_modules/node-pty/scripts/', 'node_modules/node-pty/typings/',
  'node_modules/node-pty/third_party/',
  'node_modules/node-pty/prebuilds/win32-x64/conpty.pdb',
  'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.pdb',
  'node_modules/node-pty/prebuilds/win32-arm64/conpty.pdb',
  'node_modules/node-pty/prebuilds/win32-arm64/conpty_console_list.pdb',
  'node_modules/node-pty/node_modules/node-addon-api/'
];

export function assertRuntimeFileList(files, { production = false } = {}) {
  for (const expected of localizationFiles) {
    assert(files.includes(expected), `VSIX file list is missing localization resource ${expected}`);
  }
  const forbidden = files.filter(file => forbiddenPrefixes.some(prefix => file.startsWith(prefix))
    || production && /\.(?:map|pdb)$/u.test(file));
  assert.deepEqual(forbidden, [], `VSIX file list contains non-runtime sources or debug payload:\n${forbidden.join('\n')}`);
}

export function assertSafeVsixEntry(entry) {
  const original = entry.unsafeOriginalName ?? entry.name;
  assert(original === entry.name && !original.includes('\\') && !original.includes(':')
    && !original.startsWith('/') && !original.split('/').some(part => part === '..' || part === '.'),
  `Unsafe VSIX path: ${original}`);
  assert((Number(entry.unixPermissions) & 0o170000) !== 0o120000, 'VSIX must not contain symbolic links');
}

export async function extractVsixDist(file, destination) {
  await fs.mkdir(destination, { recursive: true });
  assert.equal((await fs.readdir(destination)).length, 0, 'Candidate dist must have a private empty destination');
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  let count = 0;
  for (const entry of Object.values(zip.files)) {
    assertSafeVsixEntry(entry);
    if (entry.dir || !entry.name.startsWith('extension/dist/')) continue;
    const relative = entry.name.slice('extension/dist/'.length);
    assert(relative && !relative.split('/').includes(''), 'VSIX dist contains an empty path component');
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async('nodebuffer'), { flag: 'wx',
      mode: entry.unixPermissions === null ? 0o644 : Number(entry.unixPermissions) & 0o777 });
    count++;
  }
  assert(count, 'VSIX has no dist payload');
}
