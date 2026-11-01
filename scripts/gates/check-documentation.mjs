import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function changedFiles(root, base, input) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, input], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}
export function documentationLinks(text) {
  const prose = text.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1\s*$/gm, '').replace(/`[^`\n]+`/g, '');
  return [...prose.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1].replace(/^<|>$/g, ''));
}
export function checkDocumentation({ root = process.cwd(), paths }) {
  const checked = [], deleted = paths.filter(file => file.endsWith('.md') && !fs.existsSync(path.join(root, file)));
  const indexPath = path.join(root, 'docs/design-docs/index.md');
  const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  for (const file of paths.filter(file => file.endsWith('.md'))) {
    const location = path.join(root, file);
    if (!fs.existsSync(location)) continue;
    assert(fs.lstatSync(location).isFile() && !fs.lstatSync(location).isSymbolicLink(), `Documentation must be a regular file: ${file}`);
    const text = fs.readFileSync(location, 'utf8');
    for (const link of documentationLinks(text)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(link)) continue;
      const target = decodeURIComponent(link.split('#')[0].split('?')[0]);
      if (!target) continue;
      const resolved = path.resolve(root, path.dirname(file), target);
      assert(resolved.startsWith(path.resolve(root) + path.sep), `Documentation link escapes repository: ${file} -> ${link}`);
      assert(fs.existsSync(resolved), `Broken documentation link: ${file} -> ${link}`);
    }
    if (/^docs\/design-docs\/[^/]+\.md$/.test(file) && !['index.md', 'core-beliefs.md'].includes(path.basename(file))) {
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert(frontmatter, `Missing design frontmatter: ${file}`);
      for (const key of ['title', 'decision_status', 'validation_status', 'domains', 'architecture_layers', 'related_specs', 'related_plans', 'updated_at']) {
        assert(new RegExp(`^${key}:`, 'm').test(frontmatter[1]), `Missing ${key}: ${file}`);
      }
      const status = key => frontmatter[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))[1].trim();
      const row = index.split('\n').find(line => line.includes('`' + file + '`'));
      assert(row, `Design is missing from index: ${file}`);
      for (const key of ['decision_status', 'validation_status']) assert(row.includes('| ' + status(key) + ' |'), `Design/index ${key} mismatch: ${file}`);
      for (const match of frontmatter[1].matchAll(/docs\/[\w./-]+\.md/g)) assert(fs.existsSync(path.join(root, match[0])), `Missing related document: ${match[0]}`);
    }
    checked.push(file);
  }
  if (deleted.length) {
    const tracked = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const file of tracked) {
      if (!fs.existsSync(path.join(root, file))) continue;
      for (const link of documentationLinks(fs.readFileSync(path.join(root, file), 'utf8'))) {
        if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(link)) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(link.split('#')[0])));
        assert(!deleted.includes(target), `Deleted document still linked: ${file} -> ${target}`);
      }
    }
  }
  return { status: 'passed', checked, deleted };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, input: { type: 'string' } } });
  assert(values.base && values.input);
  console.log(JSON.stringify(checkDocumentation({ paths: changedFiles(process.cwd(), values.base, values.input) })));
}
