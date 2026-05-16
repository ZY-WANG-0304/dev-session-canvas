import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

const defaultSurface = manifest.contributes.configuration.properties['devSessionCanvas.canvas.defaultSurface'];
assert.equal(defaultSurface.default, 'panel');

const panelViews = manifest.contributes.views.devSessionCanvasPanel;
assert.ok(Array.isArray(panelViews), 'Expected devSessionCanvasPanel views contribution.');
const canvasPanelView = panelViews.find((view) => view.id === 'devSessionCanvas.canvasPanel');
assert.ok(canvasPanelView, 'Expected panel route to contribute the main canvas WebviewView.');
assert.equal(canvasPanelView.type, 'webview');
assert.equal(
  canvasPanelView.when,
  "(config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged) || devSessionCanvas.canvas.panelViewVisible",
  'Expected default panel configuration to make the native Panel tab available before extension activation.'
);

assert.ok(
  !manifest.activationEvents.includes('onStartupFinished'),
  'Panel placement bootstrap should not activate the extension or reveal the canvas on every VS Code startup.'
);

console.log('extension manifest tests passed');
