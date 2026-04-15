export const DEFAULT_TERMINAL_SCROLLBACK = 1000;

export function normalizeTerminalScrollback(
  value: unknown,
  fallback = DEFAULT_TERMINAL_SCROLLBACK
): number {
  const normalizedFallback =
    normalizeTerminalScrollbackValue(fallback) ?? DEFAULT_TERMINAL_SCROLLBACK;

  return normalizeTerminalScrollbackValue(value) ?? normalizedFallback;
}

function normalizeTerminalScrollbackValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}
