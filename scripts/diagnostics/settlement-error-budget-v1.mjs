export const ERROR_POLICY = Object.freeze({
  schema: 'diagnostic-error-retention-v1',
  nameBytes: 128,
  codeBytes: 128,
  messageBytes: 2048,
  entries: 256,
  jsonBytes: 65536,
});

function prefix(value, limit) {
  let result = '', bytes = 0, truncated = false;
  for (const character of value) {
    const code = character.codePointAt(0);
    const safe = code >= 0xd800 && code <= 0xdfff ? '\ufffd' : character;
    if (safe !== character) truncated = true;
    const size = Buffer.byteLength(safe);
    if (bytes + size > limit) { truncated = true; break; }
    result += safe;
    bytes += size;
  }
  return { value: result, truncated };
}

export function normalizeError(error) {
  const result = {};
  const truncatedFields = [];
  for (const field of ['name', 'code', 'message']) {
    let value;
    try {
      const supplied = error?.[field];
      if (field === 'code' && supplied == null) { result.code = null; continue; }
      value = String(supplied ?? (field === 'name' ? 'Error' : error));
    } catch {
      result[field] = field === 'code' ? null : field === 'name' ? 'Error' : 'Uninspectable error';
      truncatedFields.push(field);
      continue;
    }
    const bounded = prefix(value, ERROR_POLICY[`${field}Bytes`]);
    result[field] = bounded.value;
    if (bounded.truncated) truncatedFields.push(field);
  }
  if (truncatedFields.length) result.truncatedFields = truncatedFields;
  return result;
}

export class ErrorBudget {
  records = [];
  #bytes = 2;
  #omitted = false;
  #firstOmittedSourceFactId = null;
  #fieldsTruncated = false;

  append(record, sourceFactId, fieldsTruncated = false) {
    this.#fieldsTruncated ||= Boolean(fieldsTruncated);
    if (this.#omitted) return false;
    const encoded = JSON.stringify(record);
    const additional = Buffer.byteLength(encoded) + (this.records.length ? 1 : 0);
    if (this.records.length >= ERROR_POLICY.entries || this.#bytes + additional > ERROR_POLICY.jsonBytes) {
      this.#omitted = true;
      this.#firstOmittedSourceFactId = sourceFactId;
      return false;
    }
    this.records.push(JSON.parse(encoded));
    this.#bytes += additional;
    return true;
  }

  snapshot() {
    return {
      retainedCount: this.records.length,
      retainedJsonBytes: this.#bytes,
      omitted: this.#omitted,
      firstOmittedSourceFactId: this.#firstOmittedSourceFactId,
      fieldsTruncated: this.#fieldsTruncated,
    };
  }
}
