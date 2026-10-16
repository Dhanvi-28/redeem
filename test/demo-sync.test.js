import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function app(authenticated = false) {
  const storage = new Map(), elements = new Map(), listeners = {}, calls = [], products = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { disabled: false, textContent: '', setAttribute() {},
      set innerHTML(html) {
        this.html = html;
        if (selector === '#main') { products.length = 0; for (const m of html.matchAll(/data-reward="([^"]+)"\s*(disabled)?/g)) products.push({ dataset: { reward: m[1] }, disabled: Boolean(m[2]) }); }
      }, get innerHTML() { return this.html || ''; },
    });
    return elements.get(selector);
  };
  const window = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); } };
  let nextId = 0;
  const context = vm.createContext({ window, Event, URLSearchParams, crypto: { randomUUID: () => 'fixture-' + ++nextId },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem(key) { return this[key]; }, setItem(key, value) { this[key] = value; }, removeItem(key) { delete this[key]; } },
    document: { querySelector: element, querySelectorAll: selector => selector === '[data-reward]' ? products : [] },
    location: { hash: '#home' }, setTimeout: () => 1, clearTimeout() {},
    fetch: async path => { calls.push(path); return path === '/api/me' ? authenticated ? { ok: true, json: async () => ({ _id: 'actual-account', name: 'Fixture', role: 'admin' }) } : { ok: false, status: 401, json: async () => ({ error: 'Please log in.' }) } : { ok: true, json: async () => ({ wallet: { balance: 9, earned: 9, spent: 0 }, deposits: [], redemptions: [], depositCount: 0, weightGrams: 0 }) }; },
  });
  vm.runInContext(readFileSync(new URL('../public/demo-store.js', import.meta.url), 'utf8'), context);
  const demo = window.EcoDemo;
  const snapshot = demo.read(); snapshot.state = { ...demo.fresh(), balance: 80, points: 80, waste: 1, count: 1,
    ledger: [{ id: 'DEMO-fixture', name: 'PET bottle', emoji: '🧴', grams: 1000, points: 80, status: 'SAVED', createdAt: '2026-10-16T00:00:00Z' }],
    activity: [{ title: 'Deposit · PET bottle', detail: '1000 g', delta: '+80' }],
  };
  demo.write(snapshot, true);
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { demo, context, products, element, calls, storage, window, flush, async page(hash) { context.location.hash = '#' + hash; window.dispatchEvent(new Event('hashchange')); await flush(); } };
}

test('twin deposit, store redemption and reset synchronize dashboard, wallet, history and inventory', async () => {
  const a = app(); await a.flush();
  assert.match(a.element('#main').innerHTML, /<strong>80<\/strong>/);
  assert.match(a.element('#main').innerHTML, /1\.000 kg/);
  assert.match(a.element('#main').innerHTML, /PET bottle/);
  assert.match(a.element('#data-mode-area').innerHTML, /Digital twin demo data/);
  await a.page('wallet'); assert.match(a.element('#main').innerHTML, /simulated deposit/);
  await a.page('history'); assert.match(a.element('#main').innerHTML, /1000 g/);
  await a.page('rewards'); assert.equal(a.products.length, 8); assert.equal(a.products[0].disabled, false);
  await a.products[0].onclick(); await a.flush();
  assert.equal(a.demo.data().wallet.balance, 0); assert.equal(a.demo.data().rewards[0].stock, 3);
  await a.page('history'); assert.match(a.element('#main').innerHTML, /Instant noodles/); assert.match(a.element('#main').innerHTML, /simulated dispense/);
  await a.page('wallet'); assert.match(a.element('#main').innerHTML, /simulated redemption/); assert.match(a.element('#main').innerHTML, /-80/);
  // The twin's reset writes a new complete snapshot, notifying an already-open page.
  a.demo.write({ version: 2, state: a.demo.fresh(), stock: a.demo.catalog.map(p => p.stock) }, true); await a.flush();
  assert.doesNotMatch(a.element('#main').innerHTML, /simulated redemption/);
  await a.page('home'); assert.doesNotMatch(a.element('#main').innerHTML, /PET bottle|Instant noodles/);
  assert.match(a.element('#main').innerHTML, /<strong>0<\/strong>/);
  assert.equal(a.demo.data().rewards[0].stock, 4);
  assert.deepEqual(a.calls, ['/api/me']); // No simulated business request reaches MongoDB.
});

test('demo requests are retry safe, enforce stock/balance and reconcile the wallet ledger', async () => {
  const a = app(); await a.flush();
  const first = await a.demo.api('/rewards/redeem', { body: { rewardId: 'demo-0' }, key: 'repeat-key' });
  const retry = await a.demo.api('/rewards/redeem', { body: { rewardId: 'demo-0' }, key: 'repeat-key' });
  assert.equal(first._id, retry._id); assert.equal(a.demo.data().rewards[0].stock, 3);
  await assert.rejects(a.demo.api('/rewards/redeem', { body: { rewardId: 'demo-1' }, key: 'new-key' }), /Insufficient/);
  const d = a.demo.data(); assert.equal(d.transactions.reduce((sum, t) => sum + t.delta, 0), d.wallet.balance);
  assert.equal(d.wallet.spent, 80); assert.equal(d.redemptions.length, 1);
  a.demo.setMode('real'); await a.flush();
  assert.equal(a.demo.active(), false); assert.equal(a.demo.data().redemptions.length, 1);
  assert.match(a.element('#main').innerHTML, /Recycle with purpose/);
});

test('cross-tab storage changes refresh a visible dashboard without a manual reload', async () => {
  const a = app(); await a.flush();
  const snapshot = a.demo.read(); snapshot.state.balance = 160; snapshot.state.points = 160;
  a.storage.set(a.demo.key, JSON.stringify(snapshot));
  for (const handler of [() => a.window.dispatchEvent(Object.assign(new Event('storage'), { key: a.demo.key }))]) handler();
  await a.flush(); assert.match(a.element('#main').innerHTML, /<strong>160<\/strong>/);
});

test('reset preserves verified account data and real operations writes are blocked in demo mode', async () => {
  const a = app(true); await a.flush();
  await assert.rejects(vm.runInContext("api('/admin/rewards', {method:'POST',body:{}})", a.context), /Switch to account data/);
  a.demo.setMode('real'); await a.flush(); assert.match(a.element('#main').innerHTML, /<strong>9<\/strong>/);
  a.demo.write({ version: 2, state: a.demo.fresh(), stock: a.demo.catalog.map(p => p.stock) }, true); await a.flush();
  assert.match(a.element('#main').innerHTML, /<strong>0<\/strong>/);
  a.demo.setMode('real'); await a.flush(); assert.match(a.element('#main').innerHTML, /<strong>9<\/strong>/);
  assert.ok(a.calls.every(path => ['/api/me', '/api/dashboard'].includes(path)));
});

test('legacy twin rewards migrate into the shared history without invented dates', async () => {
  const a = app(); await a.flush(); const snapshot = a.demo.read();
  delete snapshot.state.redemptions;
  snapshot.state.balance = 0; snapshot.state.activity.unshift({ title: 'Reward · Instant noodles', delta: '−80' });
  snapshot.stock = snapshot.stock.slice(0, 4); // Original four-product twin.
  a.storage.set(a.demo.key, JSON.stringify(snapshot));
  const d = a.demo.data(); assert.equal(d.redemptions.length, 1); assert.equal(d.redemptions[0].createdAt, null);
  assert.equal(d.rewards.length, 8);
  assert.equal(d.transactions.reduce((sum, t) => sum + t.delta, 0), d.wallet.balance);
});
