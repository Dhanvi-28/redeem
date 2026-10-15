import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('store recovers a committed interrupted redemption when its product is no longer in the catalogue', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const storageKey = 'redeem:citizen:product', key = 'original-request-key';
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', setAttribute() {}, insertAdjacentHTML(position, html) { this.innerHTML = html + this.innerHTML; } });
    return elements.get(selector);
  };
  const recover = { disabled: false, dataset: { recover: storageKey } };
  const calls = [];
  const sessionStorage = { [storageKey]: key, getItem(name) { return this[name]; }, removeItem(name) { delete this[name]; } };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: selector => selector === '[data-recover]' && sessionStorage[storageKey] ? [recover] : [] },
    location: { hash: '#rewards' }, sessionStorage,
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async path => {
      calls.push(path);
      const body = path === '/api/me' ? { _id: 'citizen', name: 'Test', role: 'citizen' } : path === '/api/rewards' ? [] : path === '/api/wallet' ? { wallet: { balance: 0 } } : { _id: 'order', status: 'pending_fulfillment' };
      return { ok: true, json: async () => body };
    },
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('#main').innerHTML, /Check interrupted redemptions/);
  assert.equal(typeof recover.onclick, 'function');
  await recover.onclick();
  assert.ok(calls.includes('/api/redemptions/by-key/original-request-key'));
  assert.equal(sessionStorage[storageKey], undefined);
  assert.match(element('#notice').textContent, /pending fulfillment/);
  assert.equal(calls.filter(path => path === '/api/rewards/redeem').length, 0);
});
