import * as path from 'path';

export function resolveContainedWorkspaceRelativePath(params: {
  filePath: string;
  workspaceFolderPath: string;
  workspaceFolderName: string;
  includeWorkspaceFolderPrefix: boolean;
}): string | undefined {
  const relativePath = path.relative(params.workspaceFolderPath, params.filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  if (!params.includeWorkspaceFolderPrefix) {
    return normalizedRelativePath;
  }

  const normalizedWorkspaceFolderName = params.workspaceFolderName.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedWorkspaceFolderName) {
    return normalizedRelativePath;
  }

  return `${normalizedWorkspaceFolderName}/${normalizedRelativePath}`;
}
