import * as vscode from 'vscode';

import {
  formatCanvasTemplateMessageDescriptor,
  getCanvasTemplateErrorDescriptor,
  type CanvasTemplateMessageDescriptor
} from '../common/canvasTemplates';
import type { CanvasTemplateStoreIssue } from './CanvasTemplateStore';

export function localizeCanvasTemplateError(error: unknown, fallback?: string): string | undefined {
  const descriptor = getCanvasTemplateErrorDescriptor(error);
  if (!descriptor) {
    return undefined;
  }

  return localizeCanvasTemplateMessageDescriptor(descriptor, error instanceof Error ? error.message : fallback);
}

export function localizeCanvasTemplateStoreIssue(issue: CanvasTemplateStoreIssue): string {
  const message = localizeCanvasTemplateMessageDescriptor(issue.messageDescriptor, issue.message);
  return vscode.l10n.t('{fileName}: {message}', {
    fileName: issue.fileName,
    message
  });
}

export function localizeCanvasTemplateMessageDescriptor(
  descriptor: CanvasTemplateMessageDescriptor | undefined,
  fallback?: string
): string {
  if (!descriptor) {
    return fallback ?? vscode.l10n.t('Canvas template operation failed.');
  }

  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'documentNotObject':
      return vscode.l10n.t('Template file is not a valid JSON object.');
    case 'unsupportedVersion':
      return vscode.l10n.t('Template version {version} is not compatible with the current extension.', {
        version: params.version ?? vscode.l10n.t('<unknown>')
      });
    case 'missingVersion':
      return vscode.l10n.t('Template file is missing a supported version field.');
    case 'missingTemplateBody':
      return vscode.l10n.t('Template file is missing the template body.');
    case 'emptyTemplate':
      return vscode.l10n.t('Template must contain at least one node.');
    case 'noCompatibleNodesForSave':
      return vscode.l10n.t('The current Canvas has no Agent / Terminal / Note nodes that can be saved as a template.');
    case 'associatedNoteRelativePathInvalid':
      return vscode.l10n.t('Associated Markdown Note "{title}" is missing a valid workspace-relative path.', {
        title: params.title ?? vscode.l10n.t('<unknown>')
      });
    case 'nodesNotArray':
      return vscode.l10n.t('Template nodes field must be an array.');
    case 'nodeKindInvalid':
      return vscode.l10n.t('Template node {index} is missing a valid kind.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'nodeGroupIndexMissing':
      return vscode.l10n.t('Template node {index} references a missing group index.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'noteContentModeUnsupported':
      return vscode.l10n.t('Template node "{title}" uses an unsupported Note content mode.', {
        title: params.title ?? vscode.l10n.t('<unknown>')
      });
    case 'noteRelativePathInvalid':
      return vscode.l10n.t('Template node "{title}" is missing a valid workspace-relative Markdown path.', {
        title: params.title ?? vscode.l10n.t('<unknown>')
      });
    case 'nonAgentMetadataIgnored':
      return vscode.l10n.t('Template node "{title}" is not an Agent, so agent metadata was ignored.', {
        title: params.title ?? vscode.l10n.t('<unknown>')
      });
    case 'nonNoteMetadataIgnored':
      return vscode.l10n.t('Template node "{title}" is not a Note, so note metadata was ignored.', {
        title: params.title ?? vscode.l10n.t('<unknown>')
      });
    case 'groupsNotArray':
      return vscode.l10n.t('Template groups field must be an array.');
    case 'groupInvalidObject':
      return vscode.l10n.t('Template group {index} is not a valid object.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'groupParentIndexMissing':
      return vscode.l10n.t('Template group {index} references a missing parent group index.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'groupParentSelf':
      return vscode.l10n.t('Template group {index} cannot reference itself as its parent group.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'groupParentCycle':
      return vscode.l10n.t('Template group {index} creates a cyclic parent-child relationship.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'edgesNotArray':
      return vscode.l10n.t('Template edges field must be an array.');
    case 'edgeInvalidObject':
      return vscode.l10n.t('Template edge {index} is not a valid object.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'edgeNodeIndexMissing':
      return vscode.l10n.t('Template edge {index} references a missing node index.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'edgeAnchorMissing':
      return vscode.l10n.t('Template edge {index} is missing a valid anchor.', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'templateNameEmpty':
      return vscode.l10n.t('Template name cannot be empty.');
    case 'positionMissing':
      return vscode.l10n.t('{subject} is missing a valid position.', {
        subject: localizeCanvasTemplateMessageSubject(params)
      });
    case 'sizeMissing':
      return vscode.l10n.t('{subject} is missing a valid size.', {
        subject: localizeCanvasTemplateMessageSubject(params)
      });
    case 'templateJsonInvalid':
      return vscode.l10n.t('Template file is not valid JSON: {message}', {
        message: params.message ?? vscode.l10n.t('<unknown>')
      });
    case 'marketplacePackageTemplatePathUnsafe':
      return vscode.l10n.t('Full template package path is unsafe: {path}', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    case 'marketplacePackageTemplateMissing':
      return vscode.l10n.t('Full template package is missing {path}.', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    case 'marketplacePackageEntryPathUnsafe':
      return vscode.l10n.t('Full template package path is unsafe: {path}', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    case 'userTemplatePathOutsideDirectory':
      return vscode.l10n.t('User template path is outside the template directory: {path}', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    case 'marketplacePackageSidecarInvalid':
      return vscode.l10n.t('Marketplace template package sidecar could not be recognized.');
    case 'marketplacePackageSidecarTemplatePathUnsafe':
      return vscode.l10n.t('templatePath in the marketplace template package sidecar is unsafe: {path}', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    case 'templateHierarchyDotSegment':
      return vscode.l10n.t('Template hierarchy cannot contain . or .. segments.');
    case 'templateHierarchyIllegalPathCharacter':
      return vscode.l10n.t('Template hierarchy "{segment}" contains invalid path characters.', {
        segment: params.segment ?? vscode.l10n.t('<unknown>')
      });
    case 'utf8Invalid':
      return vscode.l10n.t('{path} is not valid UTF-8 text.', {
        path: params.path ?? vscode.l10n.t('<unknown>')
      });
    default:
      return fallback ?? formatCanvasTemplateMessageDescriptor(descriptor);
  }
}

function localizeCanvasTemplateMessageSubject(params: Record<string, string>): string {
  switch (params.subjectId) {
    case 'templateNode':
      return vscode.l10n.t('Template node "{title}"', {
        title: params.title ?? params.index ?? vscode.l10n.t('<unknown>')
      });
    case 'templateGroup':
      return vscode.l10n.t('Template group {index}', {
        index: params.index ?? vscode.l10n.t('<unknown>')
      });
    default:
      return params.label ?? vscode.l10n.t('Template item');
  }
}
