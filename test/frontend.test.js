import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { starterRewards } from '../server/catalogue.js';

test('configured starter rewards render as product cards and cannot redeem without stock', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', setAttribute() {} });
    return elements.get(selector);
  };
  const context = vm.createContext({ document: { querySelector: element, querySelectorAll: () => [] }, location: { hash: '#rewards' },
    window: { addEventListener() {} }, sessionStorage: {},
    fetch: async path => ({ ok: true, json: async () => path === '/api/me' ? { _id: 'fixture', name: 'Fixture', role: 'admin' } : path === '/api/wallet' ? { wallet: { balance: 500 } } : starterRewards.map((r, i) => ({ ...r, _id: String(i), stock: 0, active: true, machineId: null })) }),
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const html = element('#main').innerHTML;
  for (const reward of starterRewards) assert.ok(html.includes(reward.name));
  assert.equal((html.match(/class="card reward-card"/g) || []).length, 8);
  assert.equal((html.match(/data-reward="\d+" disabled/g) || []).length, 8);
  assert.match(html, /Awaiting stock/); assert.match(html, /Manage inventory/);
});

test('a slow page response cannot overwrite a newer navigation', async () => {
  const elements = new Map(); let changePage, resolveDashboard;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', setAttribute() {} });
    return elements.get(selector);
  };
  const context = vm.createContext({ document: { querySelector: element }, location: { hash: '#home' },
    window: { addEventListener(type, fn) { changePage = fn; } },
    fetch: async path => {
      if (path === '/api/dashboard') return new Promise(resolve => resolveDashboard = resolve);
      return { ok: true, json: async () => ({ _id: 'fixture', name: 'Fixture', role: 'citizen' }) };
    },
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  context.location.hash = '#twin'; await changePage();
  resolveDashboard({ ok: true, json: async () => ({ wallet: { balance: 0, earned: 0 }, deposits: [], redemptions: [], depositCount: 0, weightGrams: 0 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('#main').innerHTML, /Challenge simulation/);
  assert.doesNotMatch(element('#main').innerHTML, /Unable to load|Your recycling, recorded/);
});

test('challenge twin is public, embeds the interactive model and never calls admin machine APIs', async () => {
  const elements = new Map(), calls = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', setAttribute() {} });
    return elements.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: element }, location: { hash: '#twin' },
    window: { addEventListener() {} },
    fetch: async path => { calls.push(path); return { ok: false, status: 401, json: async () => ({ error: 'Please log in.' }) }; },
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('#main').innerHTML, /Challenge simulation/);
  assert.match(element('#main').innerHTML, /src="\/simulation.html"/);
  assert.match(element('#nav').innerHTML, /Digital Twin/);
  assert.equal(context.location.hash, '#twin');
  assert.deepEqual(calls, ['/api/me']);
});

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
