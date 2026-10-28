// The first-run menu cursor is not a composer. Only approve the private empty
// workspace created by this fixture, selecting Yes explicitly if No is default.
function startupAction(text, accepted) {
  for (const [id, pattern] of [['theme', /Choose.*(?:theme|text style)|Select.*theme/i],
    ['trust', /Yes, I trust|Do you trust|Trust this (?:folder|directory)/i],
    ['key', /Detected a custom API key/], ['login', /Select login method:/],
    ['security', /Press Enter to continue/]]) {
    if (!pattern.test(text)) continue;
    if (accepted.has(id)) return { ready: false };
    accepted.add(id);
    return { ready: false, id, data: id === 'trust' && /❯\s*No, exit/u.test(text) ? '\x1b[B\r' : '\r' };
  }
  return { ready: !/Enter to confirm|model:\s*loading/i.test(text)
    && /^\s*[›❯](?:\s|$)/mu.test(text) && /help|shortcuts|Try|Ask|context|Claude Code/i.test(text) };
}
module.exports = { startupAction };
