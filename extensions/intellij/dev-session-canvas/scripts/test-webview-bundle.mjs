import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(projectRoot, 'build', 'generated', 'webview');
const jsPath = path.join(bundleDir, 'webview.js');
const cssPath = path.join(bundleDir, 'webview.css');

const [javascript, stylesheet] = await Promise.all([
  fs.readFile(jsPath, 'utf8'),
  fs.readFile(cssPath, 'utf8')
]);

const requiredJavascriptMarkers = [
  'devSessionCanvasPostMessage',
  'devSessionCanvasReceiveHostMessage',
  'normalizeTerminalInput',
  'installTerminalDiagnosticsProbe',
  'installJcefTerminalInputGuard',
  'webview/setTerminalDiagnostics',
  'webview/terminalDiagnostic',
  'host/terminalDiagnosticsStatus',
  'webview/createNote',
  'webview/createTerminal',
  'webview/updateNote',
  'webview/updateNodePosition',
  'webview/updateViewport',
  'webview/deleteNode',
  'webview/terminalInput',
  'webview/terminalResize',
  'webview/updateTerminalSize',
  'webview/stopTerminal',
  'host/terminalOutput',
  'host/terminalExit',
  'host/stateUpdated',
  'react-flow__container',
  'xterm'
];
const requiredStylesheetMarkers = [
  '.react-flow',
  '.dsc-root',
  '.dsc-note-node',
  '.dsc-terminal-node'
];

const missing = [];
for (const marker of requiredJavascriptMarkers) {
  if (!javascript.includes(marker)) {
    missing.push(`JavaScript bundle is missing ${marker}`);
  }
}
for (const marker of requiredStylesheetMarkers) {
  if (!stylesheet.includes(marker)) {
    missing.push(`Stylesheet bundle is missing ${marker}`);
  }
}

if (missing.length > 0) {
  throw new Error(missing.join('\n'));
}

console.log(`Verified IntelliJ webview bundle markers in ${path.relative(projectRoot, bundleDir)}`);
