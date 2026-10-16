import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/simulation.js', import.meta.url), 'utf8');
function twin(storage = new Map(), delay = false) {
  const elements = new Map(), products = [], timers = [];
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { textContent: '', value: id === 'weightInput' ? '250' : id === 'wasteType' ? 'pet' : '', disabled: false, style: {}, focus() {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) },
        set innerHTML(value) {
          this.html = value;
          if (id === 'products') { products.length = 0; for (const match of value.matchAll(/data-i="(\d+)"\s*(disabled)?/g)) { const e = element('product-' + match[1]); e.dataset = { i: match[1] }; e.disabled = Boolean(match[2]); products.push(e); } }
        }, get innerHTML() { return this.html || ''; },
      });
    }
    return elements.get(id);
  };
  let nextId = 0;
  const context = vm.createContext({ document: { getElementById: element, querySelectorAll: selector => selector === '.product' ? products : [], addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'fixture-' + ++nextId }, setTimeout: fn => { if (delay) timers.push(fn); else queueMicrotask(fn); }, setInterval() {},
  });
  vm.runInContext(source, context);
  return { element, products, storage, timers, state: () => JSON.parse(vm.runInContext('JSON.stringify(state)', context)) };
}

test('completed deposits, pending choices, balances and stock survive leaving/reopening the twin', async () => {
  const first = twin(); first.element('weightInput').value = '1000';
  await first.element('runBtn').onclick();
  assert.equal(first.state().balance, 80); assert.equal(first.state().ledger.length, 1);
  const second = twin(first.storage);
  assert.equal(second.state().balance, 80); assert.equal(second.state().pending.points, 80);
  second.element('saveBtn').onclick(); second.element('saveBtn').onclick();
  assert.equal(second.state().balance, 80); assert.equal(second.state().ledger.length, 1);
  second.element('walletRewards').onclick(); second.products[0].onclick(); second.element('confirmRedeem').onclick();
  second.element('confirmRedeem').onclick(); // A double click cannot spend twice.
  const third = twin(first.storage);
  assert.equal(third.state().balance, 0); assert.equal(third.state().count, 1);
  third.element('walletRewards').onclick();
  assert.match(third.element('products').innerHTML, /3 in stock|3 simulated in stock/);
  assert.ok(third.products.every(p => p.disabled));
  assert.match(third.element('products').innerHTML, /Need 80 more points/);
});

test('eight waste types use their own rates and reject zero-point, fractional and excessive weights', async () => {
  const app = twin(); assert.equal((app.element('wasteType').innerHTML.match(/<option/g) || []).length, 8);
  for (const weight of ['0', '1', '12.5', '5001', 'NaN']) { app.element('weightInput').value = weight; await app.element('runBtn').onclick(); }
  assert.equal(app.state().count, 0); assert.equal(app.state().balance, 0);
  app.element('wasteType').value = 'glass'; app.element('weightInput').value = '1000'; await app.element('runBtn').onclick();
  assert.equal(app.state().balance, 30); assert.equal(app.state().ledger[0].name, 'Glass bottle / jar');
});

test('reset during an animation cancels its continuation without crediting a deposit', async () => {
  const app = twin(new Map(), true), running = app.element('runBtn').onclick();
  app.element('resetBtn').onclick(); app.timers.forEach(fn => fn()); await running;
  assert.equal(app.state().count, 0); assert.equal(app.state().pending, null); assert.equal(app.element('runBtn').disabled, false);
  assert.equal(twin(app.storage).state().ledger.length, 0);
});

test('corrupt or unavailable browser storage does not break the twin', () => {
  const storage = new Map([['ecosync:twin:v2', '{invalid']]); assert.equal(twin(storage).state().balance, 0);
  const inaccessible = { get() { throw Error('storage denied'); }, set() { throw Error('storage denied'); } };
  const app = twin(inaccessible); assert.match(app.element('storageNotice').textContent, /unavailable/);
});
