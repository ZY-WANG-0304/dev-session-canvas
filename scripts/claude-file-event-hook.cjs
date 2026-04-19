#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function main() {
  const payload = await readStdin();
  const parsed = parseHookPayload(payload);
  if (!parsed) {
    return;
  }

  const eventStreamPath = process.env.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH;
  if (!eventStreamPath) {
    return;
  }

  fs.mkdirSync(path.dirname(eventStreamPath), { recursive: true });
  fs.appendFileSync(eventStreamPath, `${JSON.stringify(parsed)}\n`, 'utf8');
}

function parseHookPayload(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : null;
  if (!toolName || !toolInput) {
    return null;
  }

  const accessMode = resolveAccessMode(toolName);
  if (!accessMode) {
    return null;
  }

  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
  if (!filePath) {
    return null;
  }

  return {
    path: filePath,
    accessMode,
    timestamp: new Date().toISOString()
  };
}

function resolveAccessMode(toolName) {
  if (toolName === 'Read') {
    return 'read';
  }

  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    return 'write';
  }

  return null;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let result = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      result += chunk;
    });
    process.stdin.on('end', () => resolve(result));
    process.stdin.on('error', reject);
  });
}

main().catch(() => {
  process.exitCode = 0;
});
