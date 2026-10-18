import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../gates/process.mjs';
import { compareRemotePackage } from './release-completion.mjs';

export class HTTPFailure extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}
export async function requestBytes(url, { deadline, method = 'GET', headers = {}, body,
  maxBytes = 512 * 1024 ** 2, redirects = 4 } = {}) {
  const address = new URL(url); assert(['https:', 'http:'].includes(address.protocol));
  assert(!address.username && !address.password, 'URLs must not embed credentials');
  assert(deadline > Date.now(), 'HTTP operation exceeded its original deadline');
  const result = await new Promise((resolve, reject) => {
    const transport = address.protocol === 'https:' ? https : http;
    const request = transport.request(address, { method, headers: {
      'User-Agent': 'dev-session-canvas-release-gate', ...headers
    } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume(); resolve({ redirect: new URL(response.headers.location, address), status: response.statusCode }); return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); reject(new HTTPFailure(response.statusCode)); return;
      }
      const chunks = []; let length = 0, exceeded = false;
      response.on('data', chunk => {
        if (exceeded) return;
        length += chunk.length;
        if (length > maxBytes) {
          exceeded = true;
          const error = new Error('HTTP response exceeds the bounded artifact size');
          // Reject explicitly before destroying. When an entire response has
          // already arrived, Node may have detached the socket's request error
          // handler; forwarding this Error to that idle socket is uncaught.
          reject(error); request.destroy(); return;
        }
        chunks.push(chunk);
      });
      // A destroyed response can report both its original socket error and a
      // subsequent abort. Keep listeners until retirement, and never resolve
      // a partial oversize response on an already queued end event.
      response.on('error', reject);
      response.once('end', () => { if (!exceeded) resolve({ bytes: Buffer.concat(chunks) }); });
    });
    const timer = setTimeout(() => {
      reject(new Error('HTTP query/submission deadline exceeded')); request.destroy();
    }, Math.max(1, Math.min(60000, deadline - Date.now())));
    request.once('close', () => clearTimeout(timer)); request.on('error', reject);
    if (body) request.write(body); request.end();
  });
  if (!result.redirect) return result.bytes;
  assert(redirects > 0, 'Too many artifact redirects');
  assert(address.protocol !== 'https:' || result.redirect.protocol === 'https:', 'Artifact redirect may not downgrade TLS');
  const nextHeaders = { ...headers };
  if (result.redirect.origin !== address.origin) {
    for (const key of Object.keys(nextHeaders)) if (/authorization/i.test(key)) delete nextHeaders[key];
  }
  const nextMethod = result.status === 303 ? 'GET' : method;
  return requestBytes(result.redirect, { deadline, method: nextMethod, headers: nextHeaders,
    body: nextMethod === 'GET' ? undefined : body, maxBytes, redirects: redirects - 1 });
}
const unknown = reason => ({ observation: 'unknown', content: 'unknown', remote: null,
  observedAt: new Date().toISOString(), reason });
const absent = () => ({ observation: 'absent', content: 'unknown', remote: null,
  observedAt: new Date().toISOString(), reason: null });

export function openVsxClient({ baseURL = 'https://open-vsx.org', token, request = requestBytes } = {}) {
  return {
    async query(pkg, deadline) {
      const [publisher, name] = pkg.id.split('.');
      const url = new URL(`/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(pkg.version)}`, baseURL);
      let metadata;
      try { metadata = JSON.parse((await request(url, { deadline, maxBytes: 4 * 1024 ** 2 })).toString('utf8')); }
      catch (error) { return error.status === 404 ? absent() : unknown('Open VSX version lookup is unavailable'); }
      if (metadata.namespace !== publisher || metadata.name !== name || metadata.version !== pkg.version) {
        return { ...unknown('Open VSX metadata identity differs'), observation: 'present', content: 'mismatch' };
      }
      if (typeof metadata.files?.download !== 'string') return { ...unknown('Open VSX has no downloadable package'), observation: 'present' };
      try {
        const download = new URL(metadata.files.download, baseURL);
        assert(download.origin === new URL(baseURL).origin, 'Untrusted Open VSX download origin');
        const bytes = await request(download, { deadline });
        const compared = await compareRemotePackage(bytes, pkg);
        return { observation: 'present', observedAt: new Date().toISOString(), ...compared };
      } catch { return { ...unknown('Open VSX package download/content inspection is unavailable'), observation: 'present' }; }
    },
    async submit(pkg, deadline, file) {
      if (!token) return { submission: 'not-submitted', reason: 'OVSX_PAT is unavailable' };
      const url = new URL('/api/-/publish', baseURL); url.searchParams.set('token', token);
      try {
        const bytes = await fs.readFile(file);
        const response = JSON.parse((await request(url, { method: 'POST', deadline, body: bytes,
          headers: { 'Content-Type': 'application/octet-stream' }, maxBytes: 4 * 1024 ** 2 })).toString('utf8'));
        if (response.error) return { submission: 'rejected', reason: 'Open VSX rejected the package' };
        return { submission: 'submitted', reason: null };
      } catch (error) {
        return { submission: error.status && error.status >= 400 && error.status < 500 ? 'rejected' : 'unknown',
          reason: error.status ? `Open VSX publish HTTP ${error.status}` : 'Submission completion is unknown; query before retrying' };
      }
    }
  };
}

export function visualStudioClient({ baseURL = 'https://marketplace.visualstudio.com', token,
  request = requestBytes, runner = runProcess, logPath } = {}) {
  return {
    async query(pkg, deadline) {
      try {
        const url = new URL('/_apis/public/gallery/extensionquery?api-version=7.2-preview.1', baseURL);
        const bytes = await request(url, { method: 'POST', deadline, maxBytes: 8 * 1024 ** 2,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.2-preview.1' },
          body: Buffer.from(JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: pkg.id }] }], flags: 131 })) });
        const response = JSON.parse(bytes.toString('utf8'));
        assert(Array.isArray(response.results) && response.results.length === 1);
        const extensions = response.results[0].extensions; assert(Array.isArray(extensions));
        if (!extensions.length) return absent();
        assert.equal(extensions.length, 1);
        const extension = extensions[0];
        if (`${extension.publisher?.publisherName}.${extension.extensionName}` !== pkg.id) {
          return { ...unknown('Gallery extension identity differs'), observation: 'present', content: 'mismatch' };
        }
        assert(Array.isArray(extension.versions));
        const versions = extension.versions.filter(entry => entry.version === pkg.version);
        if (!versions.length) return absent();
        assert.equal(versions.length, 1, 'Ambiguous gallery package variant');
        const files = versions[0].files?.filter(entry => entry.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
        if (files?.length !== 1 || !files[0].source) return { ...unknown('Gallery package cannot be downloaded'), observation: 'present' };
        const artifactURL = new URL(files[0].source);
        const hostname = artifactURL.hostname;
        assert(artifactURL.origin === new URL(baseURL).origin || ['gallery.vsassets.io', 'gallerycdn.vsassets.io'].some(suffix =>
          hostname === suffix || hostname.endsWith(`.${suffix}`)), 'Untrusted gallery package URL');
        const compared = await compareRemotePackage(await request(artifactURL, { deadline }), pkg);
        return { observation: 'present', observedAt: new Date().toISOString(), ...compared };
      } catch { return unknown('Gallery version/package query or content validation is unavailable'); }
    },
    async submit(_pkg, deadline, file) {
      if (!token) return { submission: 'not-submitted', reason: 'VSCE_PAT is unavailable; channel remains deferred' };
      const entry = fileURLToPath(new URL('../../node_modules/@vscode/vsce/vsce', import.meta.url));
      const result = await runner(process.execPath, [entry, 'publish', '--packagePath', file], {
        deadline, env: { ...process.env, VSCE_PAT: token }, logPath, quiet: true
      });
      return { submission: result.status === 'passed' ? 'submitted' : 'unknown',
        reason: result.status === 'passed' ? null : 'VSCE completion is unknown; query before retrying',
        commandResult: result };
    }
  };
}
