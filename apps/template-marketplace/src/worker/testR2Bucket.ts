export function createFakeR2Bucket(objects: Record<string, string>): R2Bucket {
  return {
    async get(key: string) {
      const content = objects[key];
      if (content === undefined) {
        return null;
      }
      return createFakeR2Object(key, content);
    }
  } as unknown as R2Bucket;
}

function createFakeR2Object(key: string, content: string): R2ObjectBody {
  const body = new Response(content).body;
  if (!body) {
    throw new Error('Failed to create a fake R2 object body.');
  }

  return {
    key,
    version: 'fake-version',
    size: new TextEncoder().encode(content).byteLength,
    etag: 'fake-etag',
    httpEtag: '"fake-etag"',
    checksums: {},
    uploaded: new Date('2026-05-10T00:00:00.000Z'),
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {},
    storageClass: 'Standard',
    body,
    bodyUsed: false,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
    bytes: async () => new TextEncoder().encode(content),
    text: async () => content,
    json: async <T>() => JSON.parse(content) as T,
    blob: async () => new Blob([content], { type: 'application/json' }),
    writeHttpMetadata(headers: Headers) {
      headers.set('content-type', 'application/json');
    }
  } as unknown as R2ObjectBody;
}
