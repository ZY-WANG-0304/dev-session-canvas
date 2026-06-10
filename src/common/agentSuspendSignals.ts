export function isClaudeCodeSuspendOutput(output: string): boolean {
  return countClaudeCodeSuspendOutputs(output) > 0;
}

export interface ClaudeCodeSuspendOutputDetection {
  detected: boolean;
  nextSeenCount: number;
}

const SUSPEND_OUTPUT_CONTEXT_LIMIT = 2000;

export function detectNewClaudeCodeSuspendOutput(
  output: string,
  seenCount: number | undefined,
  latestOutputChunk = '',
  previousOutput = ''
): ClaudeCodeSuspendOutputDetection {
  const currentCount = countClaudeCodeSuspendOutputs(output);
  const previousCount = normalizeSeenCount(seenCount);
  const detectedByTailCount = currentCount > previousCount;
  const detectedByAppendedContext =
    !detectedByTailCount &&
    latestOutputChunk.length > 0 &&
    countClaudeCodeSuspendOutputs(
      `${trimSuspendOutputContext(previousOutput)}${latestOutputChunk}`
    ) > countClaudeCodeSuspendOutputs(trimSuspendOutputContext(previousOutput));

  return {
    detected: detectedByTailCount || detectedByAppendedContext,
    nextSeenCount: currentCount
  };
}

export function countClaudeCodeSuspendOutputs(output: string): number {
  const normalizedOutput = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  let count = 0;
  const suspendSignalPattern = /Claude Code has been suspended\.?\s+Run `fg` to bring Claude Code back/g;
  while (suspendSignalPattern.exec(normalizedOutput)) {
    count += 1;
  }

  return count;
}

function normalizeSeenCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

function trimSuspendOutputContext(value: string): string {
  return value.length > SUSPEND_OUTPUT_CONTEXT_LIMIT ? value.slice(-SUSPEND_OUTPUT_CONTEXT_LIMIT) : value;
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
