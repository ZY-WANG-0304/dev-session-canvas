const THEME_SELECTION_PATTERN = /(?:Choose the text style|Choose.*(?:theme|text style)|Select.*theme)/i;

function hasThemeSelectionPrompt(text) {
  return String(text).split(/\r?\n/)
    .filter(line => !/^\s*Tip:/i.test(line))
    .some(line => THEME_SELECTION_PATTERN.test(line));
}

module.exports = { hasThemeSelectionPrompt };
