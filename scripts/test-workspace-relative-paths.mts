import assert from 'node:assert/strict';

import { resolveContainedWorkspaceRelativePath } from '../src/common/workspaceRelativePath.ts';

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
}

run();
