export const RESOURCE_URLS_DATA_TRANSFER = 'ResourceURLs';
export const CODE_FILES_DATA_TRANSFER = 'CodeFiles';
export const URI_LIST_DATA_TRANSFER = 'text/uri-list';

export function hasPotentialDroppedResource(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  return [RESOURCE_URLS_DATA_TRANSFER, CODE_FILES_DATA_TRANSFER, URI_LIST_DATA_TRANSFER].some((type) =>
    hasDataTransferType(dataTransfer, type)
  );
}

export function hasDataTransferType(dataTransfer: DataTransfer, type: string): boolean {
  const dataTransferTypes = dataTransfer.types;
  if (!dataTransferTypes) {
    return false;
  }

  const contains = (dataTransferTypes as { contains?: (value: string) => boolean }).contains;
  if (typeof contains === 'function') {
    return contains.call(dataTransferTypes, type);
  }

  return Array.from(dataTransferTypes).some((entry) => entry === type);
}

export function parseDroppedStringArray(rawValue: string): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
