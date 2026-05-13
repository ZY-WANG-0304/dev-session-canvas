type FakeR2ObjectInput =
  | string
  | {
      content: string | Uint8Array;
      contentType?: string;
    };

export function createFakeR2Bucket(objects: Record<string, FakeR2ObjectInput>): R2Bucket {
  return {
    async get(key: string) {
      const input = objects[key];
      if (input === undefined) {
        return null;
      }
      return createFakeR2Object(key, input);
    }
  } as unknown as R2Bucket;
}

function createFakeR2Object(key: string, input: FakeR2ObjectInput): R2ObjectBody {
  const content = typeof input === 'string' ? input : input.content;
  const contentType = typeof input === 'string' ? 'application/json' : input.contentType ?? 'application/octet-stream';
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const body = new Response(bytes).body;
  if (!body) {
    throw new Error('Failed to create a fake R2 object body.');
  }

  return {
    key,
    version: 'fake-version',
    size: bytes.byteLength,
    etag: 'fake-etag',
    httpEtag: '"fake-etag"',
    checksums: {},
    uploaded: new Date('2026-05-10T00:00:00.000Z'),
    httpMetadata: { contentType },
    customMetadata: {},
    storageClass: 'Standard',
    body,
    bodyUsed: false,
    arrayBuffer: async () => bytes.buffer,
    bytes: async () => bytes,
    text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(content)),
    json: async <T>() => JSON.parse(typeof content === 'string' ? content : new TextDecoder().decode(content)) as T,
    blob: async () => new Blob([bytes], { type: contentType }),
    writeHttpMetadata(headers: Headers) {
      headers.set('content-type', contentType);
    }
  } as unknown as R2ObjectBody;
}
