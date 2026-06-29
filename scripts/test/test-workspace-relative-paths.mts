import assert from 'node:assert/strict';

import { formatExecutionCwdLabel, formatExecutionCwdTooltip } from '../../extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts';
import { resolveContainedWorkspaceRelativePath } from '../../extensions/vscode/dev-session-canvas/src/common/workspaceRelativePath.ts';

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
    'src/',
    '单根 workspace 下执行 cwd 标签应省略 workspace folder 前缀，并保留目录尾缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace', [{ name: 'workspace', path: '/workspace' }]),
    'workspace/',
    '执行 cwd 等于 workspace root 时应显示 workspace folder 名称，并保留目录尾缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace-b/src', [
      { name: 'workspace-a', path: '/workspace-a' },
      { name: 'workspace-b', path: '/workspace-b' }
    ]),
    'workspace-b/src/',
    '多根 workspace 下执行 cwd 标签应保留 workspace folder 前缀和目录尾缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/outside/tooling', [{ name: 'workspace', path: '/workspace' }]),
    'tooling/',
    'workspace 外 cwd 应退化为带目录尾缀的目录名，避免泄漏过长绝对路径。'
  );

  assert.equal(
    formatExecutionCwdLabel('C:\\workspace\\src', [{ name: 'workspace', path: 'c:/workspace' }]),
    'src\\',
    'Windows 反斜杠盘符路径的执行 cwd 标签应按不区分大小写的 workspace 包含关系计算，并保留来源分隔符。'
  );

  assert.equal(
    formatExecutionCwdLabel('C:/workspace/src', [{ name: 'workspace', path: 'C:\\workspace' }]),
    'src/',
    'Windows slash-style 盘符 cwd 标签仍应保留来源分隔符。'
  );

  assert.equal(
    formatExecutionCwdLabel('C:\\workspace-b\\src', [
      { name: 'workspace-a', path: 'C:\\workspace-a' },
      { name: 'workspace-b', path: 'C:\\workspace-b' }
    ]),
    'workspace-b\\src\\',
    'Windows 多根 workspace 下执行 cwd 标签应保留 workspace folder 前缀，并使用原生分隔符。'
  );

  assert.equal(
    formatExecutionCwdTooltip('C:\\workspace\\src'),
    'C:\\workspace\\src\\',
    'Windows 反斜杠执行 cwd tooltip 应保留来源分隔符的完整路径，并保留目录尾缀。'
  );

  assert.equal(
    formatExecutionCwdTooltip('C:/workspace/src'),
    'C:/workspace/src/',
    'Windows slash-style 执行 cwd tooltip 应保留 slash 来源分隔符。'
  );

  assert.equal(
    formatExecutionCwdLabel('\\\\server\\share\\workspace\\src', [
      { name: 'workspace', path: '\\\\server\\share\\workspace' }
    ]),
    'src\\',
    'Windows 反斜杠 UNC cwd 标签应保留来源分隔符。'
  );

  assert.equal(
    formatExecutionCwdLabel('//server/share/workspace/src', [
      { name: 'workspace', path: '//server/share/workspace' }
    ]),
    'src/',
    'slash-style network cwd 标签不应被改写成反斜杠。'
  );

  assert.equal(
    formatExecutionCwdTooltip('//server/share/workspace/src'),
    '//server/share/workspace/src/',
    'slash-style network cwd tooltip 应保留 slash 来源分隔符。'
  );
}

run();
