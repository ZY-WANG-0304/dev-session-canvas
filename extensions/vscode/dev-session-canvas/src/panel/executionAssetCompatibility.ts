function versionParts(value: unknown): number[] {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('Invalid execution asset library version.');
  }
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Invalid execution asset library version.');
  return parts;
}

export function assertMinimumExecutionLibraryVersion(actual: unknown, minimum: unknown): void {
  const current = versionParts(actual);
  const required = versionParts(minimum);
  for (let index = 0; index < Math.max(current.length, required.length); index++) {
    if ((current[index] ?? 0) > (required[index] ?? 0)) return;
    if ((current[index] ?? 0) < (required[index] ?? 0)) throw new Error('Execution asset library minimum is not met.');
  }
}

export function assertExecutionAssetRuntime(runtime: Record<string, unknown>, requiredNapi: unknown): void {
  if (!['node', 'electron'].includes(runtime.name as string)
      || ['version', 'node'].some(key => typeof runtime[key] !== 'string'
        || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(runtime[key] as string))
      || ['modules', 'napi'].some(key => typeof runtime[key] !== 'string' || !/^[1-9]\d*$/.test(runtime[key] as string))
      || (runtime.name === 'node' && runtime.version !== runtime.node)) {
    throw new Error('Execution asset build runtime provenance is invalid.');
  }
  const current = process.versions.napi;
  if (requiredNapi !== 8 || typeof current !== 'string' || !/^[1-9]\d*$/.test(current)
      || !Number.isSafeInteger(Number(current)) || Number(current) < requiredNapi) {
    throw new Error('Execution assets require N-API >=8.');
  }
}
