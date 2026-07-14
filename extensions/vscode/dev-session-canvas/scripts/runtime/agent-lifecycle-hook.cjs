#!/usr/bin/env node

const net = require('net');

const CALLBACK_TIMEOUT_MS = 5000;

async function main() {
  const event = await readProviderEvent();
  if (!event) {
    return;
  }

  const endpoint = process.env.DEV_SESSION_CANVAS_AGENT_LIFECYCLE_ENDPOINT;
  const runtimeSessionId = process.env.DEV_SESSION_CANVAS_AGENT_LIFECYCLE_RUNTIME_SESSION_ID;
  const processEpoch = process.env.DEV_SESSION_CANVAS_AGENT_LIFECYCLE_PROCESS_EPOCH;
  const callbackNonce = process.env.DEV_SESSION_CANVAS_AGENT_LIFECYCLE_CALLBACK_NONCE;
  if (!endpoint || !runtimeSessionId || !processEpoch || !callbackNonce) {
    return;
  }

  await sendAndWaitForAck(endpoint, {
    version: 1,
    runtimeSessionId,
    processEpoch,
    callbackNonce,
    event
  });
}

async function readProviderEvent() {
  if (process.argv[2] === 'codex') {
    const payload = parseJson(process.argv[3]);
    const providerSessionId = normalizeIdentity(payload?.['thread-id']);
    const providerTurnId = normalizeIdentity(payload?.['turn-id']);
    if (payload?.type !== 'agent-turn-complete' || !providerSessionId || !providerTurnId) {
      return null;
    }
    return {
      provider: 'codex',
      kind: 'turn-completed',
      providerSessionId,
      providerTurnId,
      observedAtMs: Date.now()
    };
  }

  if (process.argv[2] !== 'claude') {
    return null;
  }

  const hookEvent = process.argv[3];
  const payload = parseJson(await readStdin());
  const providerSessionId = normalizeIdentity(payload?.session_id);
  const providerTurnId = normalizeIdentity(payload?.prompt_id);
  if (!providerSessionId || !providerTurnId) {
    return null;
  }

  if (hookEvent === 'UserPromptSubmit') {
    return {
      provider: 'claude',
      kind: 'turn-started',
      providerSessionId,
      providerTurnId,
      observedAtMs: Date.now()
    };
  }

  if (hookEvent === 'Stop') {
    return {
      provider: 'claude',
      kind: 'turn-completed',
      providerSessionId,
      providerTurnId,
      observedAtMs: Date.now()
    };
  }

  if (hookEvent === 'StopFailure') {
    const error = summarizeFailure(payload);
    return {
      provider: 'claude',
      kind: 'turn-failed',
      providerSessionId,
      providerTurnId,
      observedAtMs: Date.now(),
      ...(error ? { error } : {})
    };
  }

  return null;
}

function summarizeFailure(payload) {
  const candidates = [
    payload?.error,
    payload?.error_message,
    payload?.message,
    payload?.api_error
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 2000);
    }
    if (candidate && typeof candidate === 'object') {
      try {
        const encoded = JSON.stringify(candidate);
        if (encoded && encoded !== '{}') {
          return encoded.slice(0, 2000);
        }
      } catch {
        // Keep checking simpler fields.
      }
    }
  }
  return undefined;
}

function sendAndWaitForAck(endpoint, envelope) {
  const separatorIndex = endpoint.lastIndexOf(':');
  const host = endpoint.slice(0, separatorIndex);
  const port = Number(endpoint.slice(separatorIndex + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let buffer = '';
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve();
    };
    socket.setEncoding('utf8');
    socket.setTimeout(CALLBACK_TIMEOUT_MS);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(envelope)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        finish();
      }
    });
    socket.on('timeout', finish);
    socket.on('error', finish);
    socket.on('end', finish);
    socket.on('close', finish);
  });
}

function parseJson(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeIdentity(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function readStdin() {
  return new Promise((resolve) => {
    let result = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      result += chunk;
    });
    process.stdin.on('end', () => resolve(result));
    process.stdin.on('error', () => resolve(''));
  });
}

main().catch(() => {
  process.exitCode = 0;
});
