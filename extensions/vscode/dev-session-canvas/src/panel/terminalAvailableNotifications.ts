import { randomUUID } from 'node:crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../common/protocol';

type Available = Extract<HostToWebviewMessage, { type: 'host/executionTerminalAvailable' }>['payload'];
type Receipt = Extract<WebviewToHostMessage, { type: 'webview/executionTerminalAvailableReceived' }>['payload'];
type Send = (payload: Available) => void | boolean | PromiseLike<boolean>;

interface Notification {
  identity: Available;
  send: Send;
  blocked: boolean;
  inFlight?: Available;
  pending?: Available;
}

/** Receipt credit bounds hints only. Journal pages and final application have separate owners. */
export class TerminalAvailableNotifications {
  private readonly notifications = new Map<string, Notification>();

  public get size(): number { return this.notifications.size; }

  public offer(key: string, payload: Available, send: Send, blocked = false): void {
    let notification = this.notifications.get(key);
    if (!notification || !sameExecution(notification.identity, payload)) {
      notification = { identity: payload, send, blocked };
      this.notifications.set(key, notification);
    }
    const previous = notification.pending ?? notification.inFlight;
    notification.pending = {
      ...payload,
      revision: Math.max(payload.revision, previous?.revision ?? 0),
      terminalTitle: payload.terminalTitle !== undefined ? payload.terminalTitle : previous?.terminalTitle
    };
    this.pump(key, notification);
  }

  public received(key: string, receipt: Receipt): void {
    const notification = this.notifications.get(key);
    if (!notification?.inFlight || notification.inFlight.receiptId !== receipt.receiptId ||
        !sameExecution(notification.identity, receipt)) return;
    notification.inFlight = undefined;
    if (!notification.pending) this.notifications.delete(key);
    else this.pump(key, notification);
  }

  public resumeMatching(matches: (key: string) => boolean): void {
    for (const [key, notification] of this.notifications) {
      if (!matches(key)) continue;
      notification.blocked = false;
      this.pump(key, notification);
    }
  }

  public clearMatching(matches: (key: string, payload: Available) => boolean): void {
    for (const [key, notification] of this.notifications) {
      if (matches(key, notification.identity)) this.notifications.delete(key);
    }
  }

  private pump(key: string, notification: Notification): void {
    if (notification.blocked || notification.inFlight || !notification.pending) return;
    const payload = { ...notification.pending, receiptId: randomUUID() };
    notification.pending = undefined;
    notification.inFlight = payload;
    const notDelivered = (): void => {
      if (this.notifications.get(key) !== notification || notification.inFlight !== payload) return;
      notification.inFlight = undefined;
      notification.pending ??= payload;
    };
    try {
      const delivery = notification.send(payload);
      if (delivery !== undefined) {
        // A successful post is not receipt credit. Retry failed delivery only on new activity.
        void Promise.resolve(delivery).then(delivered => { if (!delivered) notDelivered(); }, notDelivered);
      }
    } catch {
      notDelivered();
    }
  }
}

function sameExecution(left: Available, right: Pick<Available, 'nodeId' | 'kind' | 'executionSessionId' | 'authorityId'>): boolean {
  return left.nodeId === right.nodeId && left.kind === right.kind &&
    left.executionSessionId === right.executionSessionId && left.authorityId === right.authorityId;
}
