import { randomUUID } from 'node:crypto';
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
  marketplace?: CanvasTemplateMarketMetadata;
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

export interface CanvasTemplateMarketMetadata {
  marketTemplateId: string;
  marketTemplateSlug?: string;
  marketVersionId: string;
  installedVersionNumber: number;
  installedAt: string;
  sourceUrl: string;
  publisher?: {
    id?: string;
    githubLogin?: string;
    displayName?: string;
    avatarUrl?: string;
  };
  thumbnailKey?: string;
  checksum?: {
    sha256: string;
    sizeBytes?: number;
  };
  packageSha256?: string;
  packageSizeBytes?: number;
  manifestPath?: string;
  templatePath?: string;
  readmePath?: string;
  changelogPath?: string;
  thumbnailPath?: string;
  localTemplateId?: string;
  localCreatedAt?: string;
  templateVersion?: number;
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

    const normalizedPath = path.normalize(filePath);
    const marketplace = options.storageLocation ? await readCanvasTemplateMarketMetadata(normalizedPath) : undefined;

    return {
      template: parsedDocument.document.template,
      filePath: normalizedPath,
      fileName: path.basename(filePath),
      builtinOrder: options.builtinOrder,
      storageLocation: options.storageLocation ? { ...options.storageLocation } : undefined,
      marketplace,
      relativeDirectory: options.storageLocation
        ? getRelativeTemplateDirectory(normalizedPath, options.storageLocation.rootPath)
        : undefined
    };
  }

  public async writeUserTemplate(
    template: CanvasTemplate,
    options: {
      filePath?: string;
      targetRootPath?: string;
      relativeDirectory?: string;
      marketMetadata?: CanvasTemplateMarketMetadata;
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
    const marketplace = options.marketMetadata ? cloneMarketMetadata(options.marketMetadata) : undefined;
    await writeOrRemoveMarketMetadata(filePath, marketplace);
    return {
      template: cloneCanvasTemplate(template),
      filePath,
      fileName: path.basename(filePath),
      storageLocation,
      marketplace,
      relativeDirectory: getRelativeTemplateDirectory(filePath, storageLocation.rootPath)
    };
  }

  public async writeMarketplaceTemplatePackage(options: {
    targetRootPath?: string;
    packageDirectoryName: string;
    packageBytes: Uint8Array;
    extractedFiles: ReadonlyMap<string, Uint8Array>;
    marketMetadata: CanvasTemplateMarketMetadata;
    preserveTemplateId?: string;
    preserveCreatedAt?: string;
    legacyTemplateFilePath?: string;
  }): Promise<CanvasStoredTemplate> {
    const relativeDirectory = normalizeUserTemplateRelativeDirectory(path.join('marketplace', options.packageDirectoryName));
    const targetRootPath = path.normalize(options.targetRootPath ?? this.getUserTemplateDir());
    const packageDirectoryPath = path.join(targetRootPath, relativeDirectory);
    const storageLocation = this.assertUserTemplatePath(path.join(packageDirectoryPath, 'template.json'));
    const existingMetadata = await readMarketplacePackageMarketMetadata(packageDirectoryPath);
    const templatePath = options.marketMetadata.templatePath ?? 'template.json';
    const normalizedTemplateKey = normalizeMarketplacePackageEntryKey(templatePath);
    const normalizedTemplatePath = normalizedTemplateKey ? normalizedTemplateKey.replace(/\//g, path.sep) : undefined;
    if (!normalizedTemplateKey || !normalizedTemplatePath) {
      throw new Error(`完整模板包路径不安全：${templatePath}`);
    }
    const safeTemplatePath = normalizedTemplateKey;
    const templateEntry = options.extractedFiles.get(normalizedTemplateKey);
    if (!templateEntry) {
      throw new Error(`完整模板包缺少 ${templatePath}。`);
    }

    const parsedDocument = parseCanvasTemplateDocument(JSON.parse(decodeUtf8(templateEntry, templatePath)), {
      forceCategory: 'user'
    });
    const template = cloneCanvasTemplate(parsedDocument.document.template);
    const now = new Date().toISOString();
    template.category = 'user';
    template.id = options.preserveTemplateId ?? existingMetadata?.localTemplateId ?? `market-template-${randomFileSafeId()}`;
    template.createdAt = options.preserveCreatedAt ?? existingMetadata?.localCreatedAt ?? template.createdAt ?? now;
    template.updatedAt = template.updatedAt ?? now;

    if (options.legacyTemplateFilePath && !isPathInsideDirectory(path.normalize(options.legacyTemplateFilePath), packageDirectoryPath)) {
      const legacyTemplateFilePath = path.normalize(options.legacyTemplateFilePath);
      this.assertUserTemplatePath(legacyTemplateFilePath);
      await fs.promises.rm(legacyTemplateFilePath, { force: true });
      await fs.promises.rm(buildCanvasTemplateMarketMetadataPath(legacyTemplateFilePath), { force: true });
    }
    await fs.promises.rm(packageDirectoryPath, { recursive: true, force: true });
    await fs.promises.mkdir(packageDirectoryPath, { recursive: true });
    await fs.promises.writeFile(path.join(packageDirectoryPath, 'package.zip'), options.packageBytes);
    for (const [entryPath, bytes] of options.extractedFiles) {
      const normalizedEntryPath = normalizeMarketplacePackageEntryPath(entryPath);
      if (!normalizedEntryPath) {
        throw new Error(`完整模板包路径不安全：${entryPath}`);
      }
      const outputPath = path.join(packageDirectoryPath, normalizedEntryPath);
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, bytes);
    }

    const marketplace = cloneMarketMetadata({
      ...options.marketMetadata,
      templatePath: safeTemplatePath,
      localTemplateId: template.id,
      localCreatedAt: template.createdAt,
      templateVersion: parsedDocument.document.version
    });
    await fs.promises.writeFile(path.join(packageDirectoryPath, normalizedTemplatePath), encodeCanvasTemplateDocument(template), 'utf8');
    await writeMarketplacePackageMarketMetadata(packageDirectoryPath, marketplace);
    return {
      template,
      filePath: path.join(packageDirectoryPath, normalizedTemplatePath),
      fileName: path.basename(normalizedTemplatePath),
      storageLocation,
      marketplace,
      relativeDirectory
    };
  }

  public async deleteUserTemplate(filePath: string): Promise<void> {
    const normalizedPath = path.normalize(filePath);
    const storageLocation = this.assertUserTemplatePath(normalizedPath);
    const packageDirectoryPath = await findMarketplacePackageDirectory(normalizedPath, storageLocation.rootPath);
    if (packageDirectoryPath) {
      await fs.promises.rm(packageDirectoryPath, { recursive: true, force: true });
      return;
    }
    await fs.promises.rm(normalizedPath, { force: true });
    await fs.promises.rm(buildCanvasTemplateMarketMetadataPath(normalizedPath), { force: true });
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
    const marketplacePackageMetadataPaths = storageLocation ? await listMarketplacePackageMetadataPaths(directoryPath) : [];
    const marketplacePackageDirectories = new Set(marketplacePackageMetadataPaths.map((metadataPath) => path.dirname(metadataPath)));

    for (const metadataPath of marketplacePackageMetadataPaths) {
      try {
        templates.push(await readMarketplacePackageTemplate(metadataPath, category, storageLocation));
      } catch (error) {
        issues.push({
          category,
          filePath: metadataPath,
          fileName: path.basename(metadataPath),
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const filePaths = (await listJsonFilePaths(directoryPath)).filter(
      (filePath) => !isPathInsideAnyDirectory(filePath, marketplacePackageDirectories)
    );

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
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json') && !isCanvasTemplateMarketMetadataFile(entry.name)) {
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

async function listMarketplacePackageMetadataPaths(directoryPath: string): Promise<string[]> {
  const marketplaceRootPath = path.join(directoryPath, 'marketplace');
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(marketplaceRootPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const metadataPath = path.join(marketplaceRootPath, entry.name, '.market.json');
      try {
        const stat = await fs.promises.stat(metadataPath);
        if (stat.isFile()) {
          files.push(metadataPath);
        }
      } catch (error) {
        if (!isMissingDirectoryError(error)) {
          throw error;
        }
      }
    }
  }
  return files;
}

async function readMarketplacePackageTemplate(
  metadataPath: string,
  category: CanvasTemplateCategory,
  storageLocation: CanvasTemplateStorageLocation | undefined
): Promise<CanvasStoredTemplate> {
  const packageDirectoryPath = path.dirname(metadataPath);
  const marketplace = await readMarketplacePackageMarketMetadata(packageDirectoryPath);
  if (!marketplace) {
    throw new Error('市场模板包 sidecar 无法识别。');
  }

  const templatePath = marketplace.templatePath ?? 'template.json';
  const normalizedTemplatePath = normalizeMarketplacePackageEntryPath(templatePath);
  if (!normalizedTemplatePath) {
    throw new Error(`市场模板包 sidecar 中的 templatePath 不安全：${templatePath}`);
  }
  const templateFilePath = path.join(packageDirectoryPath, normalizedTemplatePath);
  const text = await fs.promises.readFile(templateFilePath, 'utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new Error(`模板文件不是有效 JSON：${formatUnknownError(error)}`);
  }

  const parsedDocument = parseCanvasTemplateDocument(parsedJson, {
    defaultCategory: category,
    forceCategory: category
  });

  return {
    template: parsedDocument.document.template,
    filePath: path.normalize(templateFilePath),
    fileName: path.basename(templateFilePath),
    storageLocation: storageLocation ? { ...storageLocation } : undefined,
    marketplace,
    relativeDirectory: storageLocation
      ? getRelativeTemplateDirectory(templateFilePath, storageLocation.rootPath)
      : undefined
  };
}

export function buildCanvasTemplateMarketMetadataPath(templateFilePath: string): string {
  return templateFilePath.replace(/\.json$/iu, '.market.json');
}

export function buildCanvasTemplatePackageMarketMetadataPath(packageDirectoryPath: string): string {
  return path.join(packageDirectoryPath, '.market.json');
}

function isCanvasTemplateMarketMetadataFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.market.json');
}

async function readCanvasTemplateMarketMetadata(templateFilePath: string): Promise<CanvasTemplateMarketMetadata | undefined> {
  const metadataPath = buildCanvasTemplateMarketMetadataPath(templateFilePath);
  return readCanvasTemplateMarketMetadataFile(metadataPath);
}

async function readMarketplacePackageMarketMetadata(packageDirectoryPath: string): Promise<CanvasTemplateMarketMetadata | undefined> {
  return readCanvasTemplateMarketMetadataFile(buildCanvasTemplatePackageMarketMetadataPath(packageDirectoryPath));
}

async function readCanvasTemplateMarketMetadataFile(metadataPath: string): Promise<CanvasTemplateMarketMetadata | undefined> {
  let text: string;
  try {
    text = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (error) {
    if (isMissingDirectoryError(error) || (isNodeError(error) && error.code === 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return parseCanvasTemplateMarketMetadata(parsed);
}

async function writeOrRemoveMarketMetadata(
  templateFilePath: string,
  metadata: CanvasTemplateMarketMetadata | undefined
): Promise<void> {
  const metadataPath = buildCanvasTemplateMarketMetadataPath(templateFilePath);
  if (!metadata) {
    await fs.promises.rm(metadataPath, { force: true });
    return;
  }

  await fs.promises.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function writeMarketplacePackageMarketMetadata(
  packageDirectoryPath: string,
  metadata: CanvasTemplateMarketMetadata
): Promise<void> {
  const metadataPath = buildCanvasTemplatePackageMarketMetadataPath(packageDirectoryPath);
  await fs.promises.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function parseCanvasTemplateMarketMetadata(value: unknown): CanvasTemplateMarketMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const marketTemplateId = readNonEmptyString(value.marketTemplateId);
  const marketVersionId = readNonEmptyString(value.marketVersionId);
  const installedVersionNumber = typeof value.installedVersionNumber === 'number' && Number.isFinite(value.installedVersionNumber)
    ? value.installedVersionNumber
    : undefined;
  const installedAt = readNonEmptyString(value.installedAt);
  const sourceUrl = readNonEmptyString(value.sourceUrl);
  if (!marketTemplateId || !marketVersionId || installedVersionNumber === undefined || !installedAt || !sourceUrl) {
    return undefined;
  }

  return {
    marketTemplateId,
    marketTemplateSlug: readOptionalString(value.marketTemplateSlug),
    marketVersionId,
    installedVersionNumber,
    installedAt,
    sourceUrl,
    publisher: parseMarketPublisher(value.publisher),
    thumbnailKey: readOptionalString(value.thumbnailKey),
    checksum: parseMarketChecksum(value.checksum),
    packageSha256: readOptionalString(value.packageSha256),
    packageSizeBytes: typeof value.packageSizeBytes === 'number' && Number.isFinite(value.packageSizeBytes) ? value.packageSizeBytes : undefined,
    manifestPath: readOptionalString(value.manifestPath),
    templatePath: readOptionalString(value.templatePath),
    readmePath: readOptionalString(value.readmePath),
    changelogPath: readOptionalString(value.changelogPath),
    thumbnailPath: readOptionalString(value.thumbnailPath),
    localTemplateId: readOptionalString(value.localTemplateId),
    localCreatedAt: readOptionalString(value.localCreatedAt),
    templateVersion: typeof value.templateVersion === 'number' && Number.isFinite(value.templateVersion) ? value.templateVersion : undefined
  };
}

function parseMarketPublisher(value: unknown): CanvasTemplateMarketMetadata['publisher'] {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    id: readOptionalString(value.id),
    githubLogin: readOptionalString(value.githubLogin),
    displayName: readOptionalString(value.displayName),
    avatarUrl: readOptionalString(value.avatarUrl)
  };
}

function parseMarketChecksum(value: unknown): CanvasTemplateMarketMetadata['checksum'] {
  if (!isRecord(value)) {
    return undefined;
  }
  const sha256 = readNonEmptyString(value.sha256);
  if (!sha256) {
    return undefined;
  }
  return {
    sha256,
    sizeBytes: typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes) ? value.sizeBytes : undefined
  };
}

function cloneMarketMetadata(metadata: CanvasTemplateMarketMetadata): CanvasTemplateMarketMetadata {
  return JSON.parse(JSON.stringify(metadata)) as CanvasTemplateMarketMetadata;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function normalizeMarketplacePackageEntryPath(value: string): string | undefined {
  const normalized = normalizeMarketplacePackageEntryKey(value);
  return normalized ? normalized.replace(/\//g, path.sep) : undefined;
}

function normalizeMarketplacePackageEntryKey(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.includes('\0')
  ) {
    return undefined;
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return undefined;
  }
  return parts.join('/');
}

async function findMarketplacePackageDirectory(filePath: string, rootPath: string): Promise<string | undefined> {
  const normalizedRoot = path.normalize(rootPath);
  let currentPath = path.dirname(filePath);
  while (currentPath.startsWith(ensureTrailingSeparator(normalizedRoot))) {
    const metadataPath = buildCanvasTemplatePackageMarketMetadataPath(currentPath);
    try {
      const stat = await fs.promises.stat(metadataPath);
      if (stat.isFile()) {
        return currentPath;
      }
    } catch (error) {
      if (!isMissingDirectoryError(error)) {
        throw error;
      }
    }
    const nextPath = path.dirname(currentPath);
    if (nextPath === currentPath) {
      return undefined;
    }
    currentPath = nextPath;
  }
  return undefined;
}

function isPathInsideAnyDirectory(filePath: string, directories: ReadonlySet<string>): boolean {
  for (const directoryPath of directories) {
    if (isPathInsideDirectory(filePath, directoryPath)) {
      return true;
    }
  }
  return false;
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function decodeUtf8(bytes: Uint8Array, filePath: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error(`${filePath} 不是有效 UTF-8 文本。`);
  }
}

function randomFileSafeId(): string {
  return randomUUID();
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
