import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import esbuild from 'esbuild';

const bundledHelpers = await esbuild.build({
  stdin: {
    contents: `
      export { formatExecutionCwdLabel, formatExecutionCwdTooltip } from './src/common/executionCwdLabel';
      export { resolveContainedWorkspaceRelativePath } from './src/common/workspaceRelativePath';
    `,
    resolveDir: process.cwd(),
    sourcefile: 'workspace-relative-paths-entry.ts'
  },
  bundle: true,
  format: 'cjs',
  write: false,
  platform: 'node',
  target: 'node18'
});

const require = createRequire(import.meta.url);
const module = { exports: {} };
vm.runInNewContext(bundledHelpers.outputFiles[0]?.text ?? '', {
  module,
  exports: module.exports,
  require
});

const {
  formatExecutionCwdLabel,
  formatExecutionCwdTooltip,
  resolveContainedWorkspaceRelativePath
} = module.exports as {
  formatExecutionCwdLabel: typeof import('../../src/common/executionCwdLabel.ts').formatExecutionCwdLabel;
  formatExecutionCwdTooltip: typeof import('../../src/common/executionCwdLabel.ts').formatExecutionCwdTooltip;
  resolveContainedWorkspaceRelativePath: typeof import('../../src/common/workspaceRelativePath.ts').resolveContainedWorkspaceRelativePath;
};

function run(): void {
  assert.equal(
    resolveContainedWorkspaceRelativePath({
      filePath: '/workspace/src/index.ts',
      workspaceFolderPath: '/workspace',
      workspaceFolderName: 'workspace',
      includeWorkspaceFolderPrefix: false
    }),
    'src/index.ts',
    '单根 workspace 应保持纯相对路径。'
  );

  assert.equal(
    resolveContainedWorkspaceRelativePath({
      filePath: '/workspace-a/src/index.ts',
      workspaceFolderPath: '/workspace-a',
      workspaceFolderName: 'workspace-a',
      includeWorkspaceFolderPrefix: true
    }),
    'workspace-a/src/index.ts',
    '多根 workspace 下主根目录路径应带 workspace folder 前缀。'
  );

  assert.equal(
    resolveContainedWorkspaceRelativePath({
      filePath: '/workspace-b/src/index.ts',
      workspaceFolderPath: '/workspace-b',
      workspaceFolderName: 'workspace-b',
      includeWorkspaceFolderPrefix: true
    }),
    'workspace-b/src/index.ts',
    '多根 workspace 下次级根目录路径应带 workspace folder 前缀。'
  );

  assert.equal(
    resolveContainedWorkspaceRelativePath({
      filePath: '/workspace-b/src/index.ts',
      workspaceFolderPath: '/workspace-a',
      workspaceFolderName: 'workspace-a',
      includeWorkspaceFolderPrefix: true
    }),
    undefined,
    '不在目标 workspace folder 内的文件不应伪造相对路径。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace/src', [{ name: 'workspace', path: '/workspace' }]),
    'src',
    '单根 workspace 下执行 cwd 标签应省略 workspace folder 前缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace', [{ name: 'workspace', path: '/workspace' }]),
    'workspace',
    '执行 cwd 等于 workspace root 时应显示 workspace folder 名称。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace-b/src', [
      { name: 'workspace-a', path: '/workspace-a' },
      { name: 'workspace-b', path: '/workspace-b' }
    ]),
    'workspace-b/src',
    '多根 workspace 下执行 cwd 标签应保留 workspace folder 前缀。'
  );

  const duplicateNameFolders = [
    { name: 'app', path: '/repo/frontend/app' },
    { name: 'app', path: '/repo/backend/app' }
  ];
  assert.equal(
    formatExecutionCwdLabel('/repo/frontend/app/src', duplicateNameFolders),
    'frontend/app/src',
    '重复 workspace folder name 应用父级路径消歧。'
  );
  assert.equal(
    formatExecutionCwdLabel('/repo/backend/app/src', duplicateNameFolders),
    'backend/app/src',
    '重复 workspace folder name 的另一个 root 也应保持唯一前缀。'
  );
  assert.equal(
    resolveContainedWorkspaceRelativePath({
      filePath: '/repo/backend/app/src/index.ts',
      workspaceFolderPath: '/repo/backend/app',
      workspaceFolderName: 'app',
      includeWorkspaceFolderPrefix: true,
      workspaceFolders: duplicateNameFolders
    }),
    'backend/app/src/index.ts',
    '文件活动路径在重复 workspace folder name 下也应使用消歧前缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/outside/tooling', [{ name: 'workspace', path: '/workspace' }]),
    'tooling',
    'workspace 外 cwd 应退化为目录名，避免泄漏过长绝对路径。'
  );

  assert.equal(
    formatExecutionCwdLabel('C:\\workspace\\src', [{ name: 'workspace', path: 'c:/workspace' }]),
    'src',
    'Windows 盘符路径的执行 cwd 标签应按不区分大小写的 workspace 包含关系计算。'
  );

  assert.equal(
    formatExecutionCwdTooltip('C:\\workspace\\src'),
    'C:/workspace/src',
    '执行 cwd tooltip 应展示 slash-normalized 的完整路径。'
  );
}

run();
