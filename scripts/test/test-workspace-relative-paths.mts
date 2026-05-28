import assert from 'node:assert/strict';

import { formatExecutionCwdLabel } from '../../src/common/executionCwdLabel.ts';
import { resolveContainedWorkspaceRelativePath } from '../../src/common/workspaceRelativePath.ts';

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
    '单根 workspace 下执行 cwd label 应显示相对路径。'
  );

  assert.equal(
    formatExecutionCwdLabel('/workspace', [{ name: 'workspace', path: '/workspace' }]),
    'workspace',
    'workspace 根目录执行 cwd label 应显示 root 名称。'
  );

  assert.equal(
    formatExecutionCwdLabel('/repo-b/packages/api', [
      { name: 'repo-a', path: '/repo-a' },
      { name: 'repo-b', path: '/repo-b' }
    ]),
    'repo-b/packages/api',
    '多根 workspace 下执行 cwd label 应带 workspace folder 前缀。'
  );

  assert.equal(
    formatExecutionCwdLabel('/outside/project', [{ name: 'workspace', path: '/workspace' }]),
    'project',
    'workspace 外 cwd label 应回退到目录名。'
  );

  assert.equal(
    formatExecutionCwdLabel('C:\\Repo\\src', [{ name: 'Repo', path: 'C:\\Repo' }]),
    'src',
    'Windows 风格路径应按反斜杠归一化后显示相对路径。'
  );

}

run();
