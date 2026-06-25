import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  formatGitWorktreeListEntryRef,
  parseGitWorktreeListPorcelain
} from '../../src/common/gitWorktrees.ts';

const porcelainOutput = [
  'worktree /repo/main',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/main.worktrees/feature-one',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/one',
  '',
  'worktree /repo/main.worktrees/detached-review',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'locked manual verification',
  '',
  'worktree /repo/main.worktrees/stale',
  'HEAD 4444444444444444444444444444444444444444',
  'prunable gitdir file points to non-existent location',
  ''
].join('\n');

const parsed = parseGitWorktreeListPorcelain(porcelainOutput);
assert.equal(parsed.length, 4, 'Expected porcelain parser to keep all git worktree entries.');
assert.deepEqual(
  parsed.map((entry) => ({
    path: entry.worktreePath,
    branch: entry.branch,
    detached: entry.detached,
    locked: entry.locked,
    prunable: entry.prunable
  })),
  [
    {
      path: '/repo/main',
      branch: 'main',
      detached: false,
      locked: false,
      prunable: false
    },
    {
      path: '/repo/main.worktrees/feature-one',
      branch: 'feature/one',
      detached: false,
      locked: false,
      prunable: false
    },
    {
      path: '/repo/main.worktrees/detached-review',
      branch: undefined,
      detached: true,
      locked: true,
      prunable: false
    },
    {
      path: '/repo/main.worktrees/stale',
      branch: undefined,
      detached: false,
      locked: false,
      prunable: true
    }
  ],
  'Expected parser to normalize branch names and retain worktree state flags.'
);
assert.equal(
  formatGitWorktreeListEntryRef(parsed[1]),
  'feature/one',
  'Expected existing worktree labels to prefer branch names.'
);
assert.equal(
  formatGitWorktreeListEntryRef(parsed[2]),
  'detached 333333333333',
  'Expected detached worktree labels to include a short HEAD.'
);

const extensionSource = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8');
assert.match(
  extensionSource,
  /type:\s*'addExistingWorktree'[\s\S]*?Add existing worktree to workspace/u,
  'Expected the create-worktree flow to expose an add-existing-worktree branch.'
);
assert.match(
  extensionSource,
  /execGit\(rootPath, \['worktree', 'list', '--porcelain'\]\)/u,
  'Expected existing worktree selection to read git worktree list --porcelain.'
);
assert.match(
  extensionSource,
  /target\.kind === 'create'[\s\S]*?buildGitWorktreeAddArgs/u,
  'Expected git worktree add to run only for the create branch, not when adding an existing worktree.'
);

console.log('git worktree helper tests passed');
