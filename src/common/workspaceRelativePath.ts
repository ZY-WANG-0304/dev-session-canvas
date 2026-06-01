import * as path from 'path';

import { getWorkspaceFolderDisplayLabel } from './workspaceFolderLabels';

export function resolveContainedWorkspaceRelativePath(params: {
  filePath: string;
  workspaceFolderPath: string;
  workspaceFolderName: string;
  includeWorkspaceFolderPrefix: boolean;
  workspaceFolders?: readonly { name: string; path: string }[];
}): string | undefined {
  const relativePath = path.relative(params.workspaceFolderPath, params.filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  if (!params.includeWorkspaceFolderPrefix) {
    return normalizedRelativePath;
  }

  const workspaceFolder = {
    name: params.workspaceFolderName,
    path: params.workspaceFolderPath
  };
  const normalizedWorkspaceFolderName = getWorkspaceFolderDisplayLabel(
    workspaceFolder,
    params.workspaceFolders ?? [workspaceFolder]
  ).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedWorkspaceFolderName) {
    return normalizedRelativePath;
  }

  return `${normalizedWorkspaceFolderName}/${normalizedRelativePath}`;
}
