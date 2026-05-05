const NOTE_MARKDOWN_CHECKLIST_LINE_PATTERN = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/u;

export function toggleNoteMarkdownChecklistAtLine(content: string, lineNumber: number): string | null {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    return null;
  }

  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/u);
  const lineIndex = lineNumber - 1;
  if (lineIndex >= lines.length) {
    return null;
  }

  const nextLine = toggleNoteMarkdownChecklistLine(lines[lineIndex]);
  if (!nextLine) {
    return null;
  }

  const nextLines = [...lines];
  nextLines[lineIndex] = nextLine;
  return nextLines.join(lineEnding);
}

function toggleNoteMarkdownChecklistLine(line: string): string | null {
  const matched = NOTE_MARKDOWN_CHECKLIST_LINE_PATTERN.exec(line);
  if (!matched) {
    return null;
  }

  const nextMarker = matched[2] === ' ' ? 'x' : ' ';
  return line.replace(NOTE_MARKDOWN_CHECKLIST_LINE_PATTERN, `$1${nextMarker}$3`);
}
