// The first-run menu cursor is not a composer. Only approve the private empty
// workspace created by this fixture, selecting Yes explicitly if No is default.
const assert = require('node:assert/strict');
function startupAction(text, accepted, now = Date.now()) {
  const previousYesAt = accepted.trustYesAt;
  accepted.trustYesAt = undefined;
  assert(!/Select login method:|Not logged in|Invalid API key/i.test(text), 'Private CLI authentication is unavailable');
  for (const [id, pattern] of [['theme', /Choose.*(?:theme|text style)|Select.*theme/i],
    ['trust', /Yes, I trust|Do you trust|Trust this (?:folder|directory)/i],
    ['key', /Detected a custom API key/], ['login', /Select login method:/],
    ['security', /Press Enter to continue/]]) {
    if (!pattern.test(text)) continue;
    if (accepted.has(id)) return { ready: false };
    if (id === 'trust' && /Accessing workspace:/i.test(text)) {
      // Fixed Claude 2.1.280 can revert its first selection. Reuse the bounded
      // End + two positive samples policy documented by PR306/307.
      const no = /^\s*❯\s+No, exit\s*\n\s+Yes, I trust this folder\s*$/mu.test(text);
      const yes = /^\s+No, exit\s*\n\s*❯\s+Yes, I trust this folder\s*$/mu.test(text);
      assert(no !== yes && /Enter to confirm.*Esc to cancel/.test(text), 'Unknown private trust menu');
      if (no) {
        accepted.trustNavigations = (accepted.trustNavigations ?? 0) + 1;
        assert(accepted.trustNavigations <= 3, 'Private trust navigation limit reached');
        return { ready: false, id: 'trust-navigation', data: '\x1b[F' };
      }
      accepted.trustYesAt = now;
      if (previousYesAt === undefined || now - previousYesAt < 100) return { ready: false };
    }
    accepted.add(id);
    return { ready: false, id, data: '\r' };
  }
  return { ready: !/Enter to confirm|model:\s*loading/i.test(text)
    && /^\s*[›❯](?:\s|$)/mu.test(text) && /help|shortcuts|Try|Ask|context|Claude Code/i.test(text) };
}
module.exports = { startupAction };
