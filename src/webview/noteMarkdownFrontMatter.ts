import yaml from 'js-yaml';

export type NoteMarkdownFrontMatter =
  | {
      kind: 'none';
      body: string;
      lineOffset: 0;
    }
  | {
      kind: 'valid';
      body: string;
      lineOffset: number;
      rawBlock: string;
      rawYaml: string;
      entries: NoteMarkdownMetadataEntry[];
    }
  | {
      kind: 'invalid';
      body: string;
      lineOffset: 0;
      rawBlock: string;
      rawYaml: string;
      error: string;
    };

export interface NoteMarkdownMetadataEntry {
  key: string;
  value: string;
  title?: string;
}

const NOTE_MARKDOWN_FRONT_MATTER_OPENING_DELIMITER_PATTERN = /^---\s*$/u;
const NOTE_MARKDOWN_FRONT_MATTER_CLOSING_DELIMITER_PATTERN = /^(?:---|\.\.\.)\s*$/u;

export function parseNoteMarkdownFrontMatter(content: string): NoteMarkdownFrontMatter {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? content.slice(1) : content;
  const firstLine = readLineAt(source, 0);
  if (!firstLine || !NOTE_MARKDOWN_FRONT_MATTER_OPENING_DELIMITER_PATTERN.test(firstLine.text)) {
    return {
      kind: 'none',
      body: content,
      lineOffset: 0
    };
  }

  let cursor = firstLine.nextIndex;
  let lineNumber = 2;
  while (cursor < source.length) {
    const currentLine = readLineAt(source, cursor);
    if (!currentLine) {
      break;
    }

    if (NOTE_MARKDOWN_FRONT_MATTER_CLOSING_DELIMITER_PATTERN.test(currentLine.text)) {
      const rawYaml = source.slice(firstLine.nextIndex, cursor);
      const body = source.slice(currentLine.nextIndex);
      return parseNoteMarkdownFrontMatterYaml({
        rawBlock: `${bom}${source.slice(0, currentLine.nextIndex)}`,
        rawYaml,
        body,
        lineOffset: lineNumber
      });
    }

    cursor = currentLine.nextIndex;
    lineNumber += 1;
  }

  return {
    kind: 'invalid',
    body: content,
    lineOffset: 0,
    rawBlock: content,
    rawYaml: source.slice(firstLine.nextIndex),
    error: 'YAML metadata 缺少结束分隔符。'
  };
}

function parseNoteMarkdownFrontMatterYaml(params: {
  rawBlock: string;
  rawYaml: string;
  body: string;
  lineOffset: number;
}): NoteMarkdownFrontMatter {
  let parsed: unknown;
  try {
    parsed = yaml.load(params.rawYaml, {
      schema: yaml.FAILSAFE_SCHEMA
    });
  } catch (error) {
    return {
      kind: 'invalid',
      body: `${params.rawBlock}${params.body}`,
      lineOffset: 0,
      rawBlock: params.rawBlock,
      rawYaml: params.rawYaml,
      error: summarizeNoteMarkdownMetadataError(error)
    };
  }

  if (parsed === undefined || parsed === null) {
    return {
      kind: 'valid',
      body: params.body,
      lineOffset: params.lineOffset,
      rawBlock: params.rawBlock,
      rawYaml: params.rawYaml,
      entries: []
    };
  }

  if (!isNoteMarkdownMetadataRecord(parsed)) {
    return {
      kind: 'invalid',
      body: `${params.rawBlock}${params.body}`,
      lineOffset: 0,
      rawBlock: params.rawBlock,
      rawYaml: params.rawYaml,
      error: 'YAML metadata 需要使用 key/value 对象。'
    };
  }

  return {
    kind: 'valid',
    body: params.body,
    lineOffset: params.lineOffset,
    rawBlock: params.rawBlock,
    rawYaml: params.rawYaml,
    entries: Object.entries(parsed).map(([key, value]) => ({
      key,
      ...formatNoteMarkdownMetadataValue(value)
    }))
  };
}

function readLineAt(source: string, startIndex: number): { text: string; nextIndex: number } | null {
  if (startIndex > source.length) {
    return null;
  }

  const newlineIndex = source.indexOf('\n', startIndex);
  if (newlineIndex === -1) {
    return {
      text: source.slice(startIndex).replace(/\r$/u, ''),
      nextIndex: source.length
    };
  }

  return {
    text: source.slice(startIndex, newlineIndex).replace(/\r$/u, ''),
    nextIndex: newlineIndex + 1
  };
}

function summarizeNoteMarkdownMetadataError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const firstLine = rawMessage.split(/\r?\n/u, 1)[0]?.trim();
  return firstLine || 'YAML metadata 解析失败。';
}

function formatNoteMarkdownMetadataValue(value: unknown): { value: string; title?: string } {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        value: 'empty array',
        title: '[]'
      };
    }

    const firstValue =
      formatNoteMarkdownMetadataScalar(value[0]) ?? summarizeNoteMarkdownMetadataComplexValue(value[0]);
    return {
      value: value.length === 1 ? firstValue : `${firstValue} +${value.length - 1}`,
      title: value
        .map((entry) => formatNoteMarkdownMetadataScalar(entry) ?? summarizeNoteMarkdownMetadataComplexValue(entry))
        .join(', ')
    };
  }

  const scalar = formatNoteMarkdownMetadataScalar(value);
  if (scalar !== undefined) {
    return {
      value: scalar
    };
  }

  return {
    value: summarizeNoteMarkdownMetadataComplexValue(value),
    title: serializeNoteMarkdownMetadataValue(value)
  };
}

function formatNoteMarkdownMetadataScalar(value: unknown): string | undefined {
  if (value === null) {
    return 'empty';
  }

  if (typeof value === 'string') {
    return value || 'empty';
  }

  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return undefined;
}

function summarizeNoteMarkdownMetadataComplexValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `array · ${value.length}`;
  }

  if (isNoteMarkdownMetadataRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    return keys.length === 1 ? `{ ${keys[0]} }` : `{ ${keys.slice(0, 2).join(', ')} +${keys.length - 2} }`;
  }

  return String(value);
}

function isNoteMarkdownMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeNoteMarkdownMetadataValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
