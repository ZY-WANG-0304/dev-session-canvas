import { randomUUID, timingSafeEqual } from 'crypto';
import * as net from 'net';

import {
  parseAgentProviderLifecycleCallbackEnvelope,
  type AgentProviderLifecycleEvent
} from '../common/agentProviderLifecycle';
import type { AgentProviderKind } from '../common/protocol';

export const AGENT_LIFECYCLE_ENDPOINT_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_LIFECYCLE_ENDPOINT';
export const AGENT_LIFECYCLE_RUNTIME_SESSION_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_LIFECYCLE_RUNTIME_SESSION_ID';
export const AGENT_LIFECYCLE_PROCESS_EPOCH_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_LIFECYCLE_PROCESS_EPOCH';
export const AGENT_LIFECYCLE_CALLBACK_NONCE_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_LIFECYCLE_CALLBACK_NONCE';

const CALLBACK_MAX_BYTES = 256 * 1024;
const CALLBACK_SOCKET_TIMEOUT_MS = 10_000;

export interface AgentProviderLifecycleSession {
  processEpoch: string;
  callbackNonce: string;
  extraEnv: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

export interface CreateAgentProviderLifecycleSessionOptions {
  provider: AgentProviderKind;
  runtimeSessionId: string;
  onEvent: (event: AgentProviderLifecycleEvent) => void | Promise<void>;
  onRejected?: (reason: string) => void;
}

export async function createAgentProviderLifecycleSession(
  options: CreateAgentProviderLifecycleSessionOptions
): Promise<AgentProviderLifecycleSession> {
  const processEpoch = randomUUID();
  const callbackNonce = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(CALLBACK_SOCKET_TIMEOUT_MS);
    let buffer = '';
    let handled = false;

    const reject = (reason: string): void => {
      try {
        options.onRejected?.(reason);
      } catch {
        // Diagnostics must not break the callback ACK path.
      }
      writeCallbackResponse(socket, false, reason);
    };

    socket.on('data', (chunk) => {
      if (handled) {
        return;
      }
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > CALLBACK_MAX_BYTES) {
        handled = true;
        reject('payload-too-large');
        return;
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      handled = true;
      const line = buffer.slice(0, newlineIndex).trim();
      let rawEnvelope: unknown;
      try {
        rawEnvelope = JSON.parse(line);
      } catch {
        reject('invalid-json');
        return;
      }

      const envelope = parseAgentProviderLifecycleCallbackEnvelope(rawEnvelope);
      if (!envelope) {
        reject('invalid-envelope');
        return;
      }
      if (
        envelope.runtimeSessionId !== options.runtimeSessionId ||
        envelope.processEpoch !== processEpoch ||
        !safeIdentityEquals(envelope.callbackNonce, callbackNonce) ||
        envelope.event.provider !== options.provider
      ) {
        reject('identity-mismatch');
        return;
      }

      void Promise.resolve(options.onEvent(envelope.event)).then(
        () => writeCallbackResponse(socket, true),
        () => reject('handler-failed')
      );
    });
    socket.on('timeout', () => reject('timeout'));
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  const endpoint = await listenOnLoopback(server);
  let disposePromise: Promise<void> | undefined;

  return {
    processEpoch,
    callbackNonce,
    extraEnv: {
      [AGENT_LIFECYCLE_ENDPOINT_ENV_KEY]: endpoint,
      [AGENT_LIFECYCLE_RUNTIME_SESSION_ENV_KEY]: options.runtimeSessionId,
      [AGENT_LIFECYCLE_PROCESS_EPOCH_ENV_KEY]: processEpoch,
      [AGENT_LIFECYCLE_CALLBACK_NONCE_ENV_KEY]: callbackNonce
    },
    dispose() {
      if (!disposePromise) {
        disposePromise = new Promise<void>((resolve) => {
          for (const socket of sockets) {
            socket.destroy();
          }
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        });
      }
      return disposePromise;
    }
  };
}

function listenOnLoopback(server: net.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.removeListener('listening', handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.removeListener('error', handleError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Agent lifecycle callback server did not expose a TCP address.'));
        return;
      }
      resolve(`127.0.0.1:${address.port}`);
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
  });
}

function writeCallbackResponse(socket: net.Socket, ok: boolean, reason?: string): void {
  if (socket.destroyed) {
    return;
  }
  socket.end(`${JSON.stringify({ ok, ...(reason ? { reason } : {}) })}\n`);
}

function safeIdentityEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
