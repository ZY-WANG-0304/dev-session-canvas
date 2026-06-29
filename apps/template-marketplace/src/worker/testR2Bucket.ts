type FakeR2ObjectInput =
  | string
  | {
      content: string | Uint8Array;
      contentType?: string;
    };

export interface FakeR2Bucket extends R2Bucket {
  __entries: Record<string, FakeR2ObjectInput>;
}

export function createFakeR2Bucket(objects: Record<string, FakeR2ObjectInput>): FakeR2Bucket {
  const entries = { ...objects };
  return {
    __entries: entries,
    async get(key: string) {
      const input = entries[key];
      if (input === undefined) {
        return null;
      }
      return createFakeR2Object(key, input);
    },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: R2PutOptions) {
      const bytes = await readR2PutValue(value);
      entries[key] = {
        content: bytes,
        contentType: options?.httpMetadata && 'contentType' in options.httpMetadata ? options.httpMetadata.contentType : undefined
      };
      return {
        key,
        version: 'fake-version',
        size: bytes.byteLength,
        etag: 'fake-etag',
        httpEtag: '"fake-etag"',
        checksums: {},
        uploaded: new Date('2026-05-10T00:00:00.000Z'),
        httpMetadata: options?.httpMetadata ?? {},
        customMetadata: options?.customMetadata ?? {},
        storageClass: 'Standard'
      } as unknown as R2Object;
    }
  } as unknown as FakeR2Bucket;
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

async function readR2PutValue(value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Promise<Uint8Array> {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  const response = new Response(value);
  return new Uint8Array(await response.arrayBuffer());
}
