import type { CanvasNodeKind } from './protocol';

export function colorForCanvasNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '#22c55e';
    case 'terminal':
      return '#38bdf8';
    case 'note':
      return '#a78bfa';
  }
}
