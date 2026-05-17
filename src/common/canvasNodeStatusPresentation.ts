import type { CanvasNodeSummary } from './protocol';

type CanvasStatusPresentationNode = Pick<CanvasNodeSummary, 'kind' | 'status' | 'metadata'>;

export function canvasNodeStatusToneClass(node: CanvasStatusPresentationNode): string {
  const contentSource = node.kind === 'note' ? node.metadata?.note?.contentSource : undefined;
  if (contentSource?.kind === 'markdown-file') {
    return contentSource.status === 'ok' ? 'tone-success' : canvasStatusToneClass(contentSource.status);
  }

  return canvasStatusToneClass(node.status);
}

export function canvasStatusToneClass(status: string): string {
  switch (status) {
    case 'linked':
      return 'tone-success';
    case 'launching':
    case 'starting':
      return 'tone-starting';
    case 'resuming':
    case 'reattaching':
      return 'tone-resuming';
    case 'running':
      return 'tone-running';
    case 'live':
    case 'waiting-input':
    case 'resume-ready':
      return 'tone-waiting';
    case 'stopping':
    case 'stopped':
    case 'cancelled':
      return 'tone-stopped';
    case 'interrupted':
    case 'closed':
      return 'tone-disconnected';
    case 'history-restored':
      return 'tone-history';
    case 'resume-failed':
    case 'error':
    case 'missing':
    case 'not-file':
    case 'unsupported-extension':
    case 'unreadable':
    case 'dirty-conflict':
      return 'tone-error';
    default:
      return 'tone-idle';
  }
}

export function humanizeCanvasNodeStatus(node: CanvasStatusPresentationNode): string {
  if (node.kind === 'note') {
    return humanizeNoteStatus(node);
  }

  return humanizeCanvasStatus(node.status);
}

function humanizeNoteStatus(node: CanvasStatusPresentationNode): string {
  const contentSource = node.metadata?.note?.contentSource;
  if (contentSource?.kind === 'markdown-file') {
    return contentSource.status === 'ok' ? '已关联文件' : humanizeCanvasStatus(contentSource.status);
  }

  if (node.status === 'ready') {
    return '普通笔记';
  }

  return humanizeCanvasStatus(node.status);
}

export function humanizeCanvasStatus(status: string): string {
  switch (status) {
    case 'linked':
      return '已关联';
    case 'idle':
      return '未启动';
    case 'launching':
    case 'starting':
      return '启动中';
    case 'waiting-input':
      return '等待输入';
    case 'resuming':
      return '恢复中';
    case 'resume-ready':
      return '可恢复';
    case 'reattaching':
      return '重连中';
    case 'resume-failed':
      return '恢复失败';
    case 'stopping':
      return '停止中';
    case 'stopped':
      return '已停止';
    case 'running':
      return '运行中';
    case 'draft':
      return '草稿';
    case 'ready':
      return '就绪';
    case 'live':
      return '活动';
    case 'closed':
      return '已关闭';
    case 'error':
      return '失败';
    case 'cancelled':
      return '已停止';
    case 'interrupted':
      return '已中断';
    case 'history-restored':
      return '历史恢复';
    case 'missing':
      return '文件缺失';
    case 'not-file':
      return '不是文件';
    case 'unsupported-extension':
      return '格式不支持';
    case 'unreadable':
      return '无法读取';
    case 'dirty-conflict':
      return '编辑冲突';
    default:
      return status;
  }
}
