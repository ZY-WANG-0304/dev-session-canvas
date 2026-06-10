export function isClaudeCodeSuspendOutput(output: string): boolean {
  return countClaudeCodeSuspendOutputs(output) > 0;
}

export function countClaudeCodeSuspendOutputs(output: string): number {
  const normalizedOutput = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedOutput.includes('Run `fg` to bring Claude Code back')) {
    return 0;
  }

  return countOccurrences(normalizedOutput, 'Claude Code has been suspended');
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    const nextIndex = value.indexOf(needle, index);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    index = nextIndex + needle.length;
  }

  return count;
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
