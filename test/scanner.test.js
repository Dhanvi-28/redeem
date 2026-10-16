import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function scanner(getUserMedia, configured = true) {
  const elements = new Map(), messages = [], revoked = [], requests = []; let handler, stops = 0;
  const stream = { getTracks: () => [{ stop() { stops++; } }] };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', hidden: true, disabled: false, videoWidth: 640, videoHeight: 480, src: '', removeAttribute(name) { delete this[name]; }, async play() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ document: { querySelector: element, createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: cb => cb({ type: 'image/jpeg', size: 1200 }) }) },
    navigator: { mediaDevices: getUserMedia === null ? undefined : { getUserMedia: getUserMedia || (async options => { assert.equal(options.audio, false); return stream; }) } },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
    FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,fixture'; this.onload(); } },
  });
  vm.runInContext(readFileSync(new URL('../public/scanner.js', import.meta.url), 'utf8'), context);
  const cleanup = context.mountScanner({ configured, notice: s => messages.push(s), escape: s => s, bindForm: (id, cb) => handler = cb,
    api: async (path, options) => { requests.push({ path, options }); return { category: 'fixture', modelVersion: 'fixture-model' }; },
  });
  return { element, cleanup, messages, revoked, requests, submit: () => handler(), stops: () => stops, stream };
}

test('camera opens live video, captures an image, classifies it and releases hardware', async () => {
  const app = scanner();
  assert.equal(app.element('#classify').disabled, true);
  await app.element('#capture').onclick(); assert.equal(app.element('#camera-video').hidden, false);
  app.element('#take-photo').onclick(); assert.equal(app.stops(), 1);
  assert.equal(app.element('#preview').hidden, false); assert.equal(app.element('#classify').disabled, false);
  await app.submit(); assert.equal(app.requests[0].options.body.mimeType, 'image/jpeg');
  assert.match(app.element('#scan-result').innerHTML, /fixture-model/);
  app.cleanup(); assert.deepEqual(app.revoked, ['blob:fixture']);
});

test('camera denial and unsupported browsers show helpful states without opening a file picker', async () => {
  const denied = scanner(async () => { const e = new Error(); e.name = 'NotAllowedError'; throw e; });
  await denied.element('#capture').onclick(); assert.match(denied.element('#camera-status').textContent, /denied/);
  assert.equal(denied.element('#capture').disabled, false);
  const unsupported = scanner(null); await unsupported.element('#capture').onclick();
  assert.match(unsupported.element('#camera-status').textContent, /HTTPS or localhost/);
});

test('late camera permission after navigation cannot leak an active camera track', async () => {
  let resolve; const app = scanner(() => new Promise(r => resolve = r));
  const opening = app.element('#capture').onclick(); app.cleanup(); resolve(app.stream); await opening;
  assert.equal(app.stops(), 1); assert.equal(app.element('#camera-video').srcObject, null);
});

test('invalid uploads clear old results and a missing classifier remains disabled', async () => {
  const app = scanner(undefined, false);
  app.element('#image').onchange({ target: { files: [{ type: 'image/jpeg', size: 1200 }] } });
  assert.equal(app.element('#classify').disabled, true);
  await assert.rejects(app.submit(), /not configured/);
  app.element('#scan-result').innerHTML = 'stale';
  app.element('#image').onchange({ target: { files: [{ type: 'text/html', size: 100 }] } });
  assert.equal(app.element('#scan-result').innerHTML, ''); assert.equal(app.element('#preview').hidden, true);
  assert.match(app.messages.at(-1), /JPEG, PNG or WebP/);
  assert.deepEqual(app.revoked, ['blob:fixture']); assert.equal(app.requests.length, 0);
});
