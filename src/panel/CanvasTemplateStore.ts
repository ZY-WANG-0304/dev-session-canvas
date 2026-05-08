import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  cloneCanvasTemplate,
  encodeCanvasTemplateDocument,
  parseCanvasTemplateDocument,
  sanitizeCanvasTemplateFileStem,
  sortCanvasTemplates,
  type CanvasTemplate,
  type CanvasTemplateCategory
} from '../common/canvasTemplates';

export interface CanvasStoredTemplate {
  template: CanvasTemplate;
  filePath: string;
  fileName: string;
  builtinOrder?: number;
  storageLocation?: CanvasTemplateStorageLocation;
  relativeDirectory?: string;
}

export interface CanvasTemplateCatalog {
  templates: CanvasStoredTemplate[];
  issues: CanvasTemplateStoreIssue[];
}

export interface CanvasTemplateStorageLocation {
  id: string;
  label: string;
  rootPath: string;
  scope: 'global' | 'workspace';
}

export interface CanvasTemplateStoreIssue {
  category: CanvasTemplateCategory;
  filePath: string;
  fileName: string;
  message: string;
}

export class CanvasTemplateStore {
  private readonly userTemplateLocations: CanvasTemplateStorageLocation[];

  public constructor(
    private readonly builtinTemplateDir: string,
    userTemplateDirOrLocations: string | readonly CanvasTemplateStorageLocation[]
  ) {
    this.userTemplateLocations =
      typeof userTemplateDirOrLocations === 'string'
        ? [
            {
              id: 'global',
              label: '当前设备',
              rootPath: path.normalize(userTemplateDirOrLocations),
              scope: 'global'
            }
          ]
        : userTemplateDirOrLocations.map((location) => ({
            ...location,
            rootPath: path.normalize(location.rootPath)
          }));
  }

  public getBuiltinTemplateDir(): string {
    return this.builtinTemplateDir;
  }

  public getUserTemplateDir(): string {
    return this.userTemplateLocations.find((location) => location.scope === 'global')?.rootPath ?? this.userTemplateLocations[0]?.rootPath ?? '';
  }

  public getUserTemplateLocations(): CanvasTemplateStorageLocation[] {
    return this.userTemplateLocations.map((location) => ({ ...location }));
  }

  public async listTemplates(): Promise<CanvasTemplateCatalog> {
    const builtinEntries = await this.readTemplateDirectory(this.builtinTemplateDir, 'builtin');
    const userEntryCollections = await Promise.all(
      this.userTemplateLocations.map((location) => this.readTemplateDirectory(location.rootPath, 'user', location))
    );

    return {
      templates: sortCanvasTemplates([
        ...builtinEntries.templates,
        ...userEntryCollections.flatMap((collection) => collection.templates)
      ]),
      issues: [...builtinEntries.issues, ...userEntryCollections.flatMap((collection) => collection.issues)]
    };
  }

  public async readTemplateFile(
    filePath: string,
    options: {
      defaultCategory?: CanvasTemplateCategory;
      forceCategory?: CanvasTemplateCategory;
      builtinOrder?: number;
      storageLocation?: CanvasTemplateStorageLocation;
    } = {}
  ): Promise<CanvasStoredTemplate> {
    const text = await fs.promises.readFile(filePath, 'utf8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch (error) {
      throw new Error(`模板文件不是有效 JSON：${formatUnknownError(error)}`);
    }

    const parsedDocument = parseCanvasTemplateDocument(parsedJson, {
      defaultCategory: options.defaultCategory,
      forceCategory: options.forceCategory
    });

    return {
      template: parsedDocument.document.template,
      filePath: path.normalize(filePath),
      fileName: path.basename(filePath),
      builtinOrder: options.builtinOrder,
      storageLocation: options.storageLocation ? { ...options.storageLocation } : undefined,
      relativeDirectory: options.storageLocation
        ? getRelativeTemplateDirectory(path.normalize(filePath), options.storageLocation.rootPath)
        : undefined
    };
  }

  public async writeUserTemplate(
    template: CanvasTemplate,
    options: {
      filePath?: string;
      targetRootPath?: string;
      relativeDirectory?: string;
    } = {}
  ): Promise<CanvasStoredTemplate> {
    const relativeDirectory = normalizeUserTemplateRelativeDirectory(options.relativeDirectory);
    const filePath = options.filePath
      ? path.normalize(options.filePath)
      : path.join(
          path.normalize(options.targetRootPath ?? this.getUserTemplateDir()),
          relativeDirectory,
          `${sanitizeCanvasTemplateFileStem(template.name, template.id)}.json`
        );
    const storageLocation = this.assertUserTemplatePath(filePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, encodeCanvasTemplateDocument(template), 'utf8');
    return {
      template: cloneCanvasTemplate(template),
      filePath,
      fileName: path.basename(filePath),
      storageLocation,
      relativeDirectory: getRelativeTemplateDirectory(filePath, storageLocation.rootPath)
    };
  }

  public async deleteUserTemplate(filePath: string): Promise<void> {
    const normalizedPath = path.normalize(filePath);
    this.assertUserTemplatePath(normalizedPath);
    await fs.promises.rm(normalizedPath, { force: true });
  }

  public async exportTemplateToFile(template: CanvasTemplate, filePath: string): Promise<void> {
    const normalizedPath = path.normalize(filePath);
    await fs.promises.mkdir(path.dirname(normalizedPath), { recursive: true });
    await fs.promises.writeFile(normalizedPath, encodeCanvasTemplateDocument(template), 'utf8');
  }

  private async readTemplateDirectory(
    directoryPath: string,
    category: CanvasTemplateCategory,
    storageLocation?: CanvasTemplateStorageLocation
  ): Promise<CanvasTemplateCatalog> {
    const templates: CanvasStoredTemplate[] = [];
    const issues: CanvasTemplateStoreIssue[] = [];
    const filePaths = await listJsonFilePaths(directoryPath);

    for (const [index, filePath] of filePaths.entries()) {
      const fileName = path.basename(filePath);
      try {
        templates.push(
          await this.readTemplateFile(filePath, {
            defaultCategory: category,
            forceCategory: category,
            builtinOrder: category === 'builtin' ? index : undefined,
            storageLocation
          })
        );
      } catch (error) {
        issues.push({
          category,
          filePath,
          fileName,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      templates,
      issues
    };
  }

  private assertUserTemplatePath(candidatePath: string): CanvasTemplateStorageLocation {
    const normalizedPath = path.normalize(candidatePath);
    const location = this.userTemplateLocations.find((entry) =>
      normalizedPath.startsWith(ensureTrailingSeparator(path.normalize(entry.rootPath)))
    );
    if (!location) {
      throw new Error(`用户模板路径超出模板目录：${candidatePath}`);
    }
    return { ...location };
  }
}

async function listJsonFilePaths(directoryPath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingDirectoryError(error) && currentPath === directoryPath) {
        return;
      }
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(entryPath);
      }
    }
  }

  try {
    await visit(directoryPath);
    return files.sort((left, right) => {
      const leftRelative = path.relative(directoryPath, left);
      const rightRelative = path.relative(directoryPath, right);
      return leftRelative.localeCompare(rightRelative, 'zh-Hans-CN');
    });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

function normalizeUserTemplateRelativeDirectory(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const segments = value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('模板层级不能包含 . 或 ..。');
    }

    if (/[<>:"|?*\x00-\x1F]/.test(segment)) {
      throw new Error(`模板层级「${segment}」包含非法路径字符。`);
    }
  }

  return segments.join(path.sep);
}

function getRelativeTemplateDirectory(filePath: string, rootPath: string): string {
  const relativeFilePath = path.relative(rootPath, filePath);
  const relativeDirectory = path.dirname(relativeFilePath);
  return relativeDirectory === '.' ? '' : relativeDirectory;
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function isMissingDirectoryError(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
