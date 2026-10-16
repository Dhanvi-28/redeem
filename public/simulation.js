// Browser-only demo. Never writes to account wallets or controller APIs.
const materials = {
  pet: ['PET bottle', '🧴', 'PET', .08], can: ['Aluminium can', '🥫', 'AL', .12],
  paper: ['Paper / cardboard', '📦', 'PAP', .04], glass: ['Glass bottle / jar', '🍾', 'GLASS', .03],
  hdpe: ['HDPE container', '🧴', 'HDPE', .07], steel: ['Steel / tin can', '🥫', 'STEEL', .06],
  cartons: ['Beverage carton', '🧃', 'CARTON', .04], textiles: ['Clean textiles', '👕', 'TEXTILE', .02],
};
const demo = window.EcoDemo;
const catalog = demo.catalog.map(p => ({ ...p })), initialStock = catalog.map(p => p.stock), storageKey = demo.key;
const fresh = demo.fresh;
let state = fresh(), busy = false;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saved = demo.read(); state = { ...saved.state, selected: null };
catalog.forEach((p, i) => p.stock = saved.stock[i]);
const pending = state.pending;
if (pending && (!materials[pending.key] || !Number.isInteger(pending.grams) || pending.grams < 1 || pending.grams > 5000 || pending.points !== Math.floor(pending.grams * materials[pending.key][3]))) state.pending = null;
function persist(activate = false) {
  try {
    demo.write({ version: 2, state, stock: catalog.map(p => p.stock) }, activate);
    $('storageNotice').textContent = 'Demo deposits, wallet, rewards and history sync with the main dashboard. Reset clears all demo views. Account records remain separate.';
  } catch { $('storageNotice').textContent = 'Browser storage is unavailable or full. Further changes cannot be saved or synced after leaving this page.'; }
}
const steps = [['Identify citizen', 'QR identity recognized (demo)'], ['Inspect item', 'Illustrative material ruleset'], ['Measure weight', 'Validate simulated weight'], ['Sort & credit', 'Calculate demo points'], ['Choose outcome', 'Save points or redeem']];
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 4000); }
function renderSteps() { $('steps').innerHTML = steps.map((s, i) => `<div class="step ${i < state.step ? 'done' : i === state.step ? 'current' : ''}"><div class="step-dot">${i < state.step ? '✓' : i + 1}</div><div class="step-text"><b>${s[0]}</b><small>${s[1]}</small></div></div>`).join(''); }
function render(activate = false) {
  $('balance').textContent = state.balance; $('wasteMetric').textContent = state.waste.toFixed(2) + ' kg';
  $('pointsMetric').textContent = state.points; $('depositMetric').textContent = state.count;
  $('walletMeter').style.width = Math.min(100, state.balance / 5) + '%'; $('activityCount').textContent = state.activity.length + ' EVENTS';
  $('activityList').innerHTML = state.activity.length ? state.activity.slice(0, 3).map(a => `<div class="activity-row"><div class="activity-left"><div class="activity-icon">${escape(a.icon)}</div><div>${escape(a.title)}<small>${escape(a.detail)}</small></div></div><span class="activity-pts">${escape(a.delta)}</span></div>`).join('') : '<div class="empty">Your simulated transactions will appear here.</div>';
  $('ledger').innerHTML = state.ledger.length ? state.ledger.map(x => `<tr><td>${escape(x.id)}</td><td>${escape(x.emoji)} ${escape(x.name)}</td><td>${escape(x.grams)} g</td><td>+${escape(x.points)} pts</td><td><span class="pill">${escape(x.status)}</span></td></tr>`).join('') : '<tr><td class="empty" colspan="5">No deposits yet. Start a simulation above.</td></tr>';
  renderSteps(); persist(activate);
}
function enableChoices(on) { $('choices').classList.toggle('hidden', !on); $('runBtn').classList.toggle('hidden', on); }
function inputs(disabled) { $('wasteType').disabled = $('weightInput').disabled = disabled; }
function quote() {
  const m = materials[$('wasteType').value], grams = Number($('weightInput').value);
  if (m) $('selectedBin').textContent = m[2];
  $('depositLimit').textContent = m ? `Demo rate: ${m[3] * 1000} pts/kg · minimum ${Math.ceil(1 / m[3])} g for 1 point · maximum 5,000 g. ${Number.isInteger(grams) && grams > 0 && grams <= 5000 ? 'Estimated reward: ' + Math.floor(grams * m[3]) + ' pts.' : 'Enter a whole-number weight within the limit.'}` : 'Choose a supported material.';
}
function ready() {
  inputs(false); enableChoices(false); $('runBtn').disabled = false; $('wasteItem').style.transform = '';
  $('wasteScreenTitle').textContent = 'READY · SCAN ID'; $('wasteScreenBig').textContent = 'Place item to begin';
  $('wasteScreenSmall').textContent = 'Illustrative rules · no hardware'; $('vendScreenTitle').textContent = 'REDEMPTION · STANDBY';
  $('vendScreenBig').textContent = 'Choose a reward'; $('vendScreenSmall').textContent = 'Shared demo wallet · ' + state.balance + ' pts';
}
function showPending() {
  const p = state.pending; inputs(true); enableChoices(true); state.step = 4;
  $('wasteScreenTitle').textContent = 'DEPOSIT ACCEPTED · DEMO'; $('wasteScreenBig').textContent = '+' + p.points + ' points';
  $('wasteScreenSmall').textContent = p.grams + ' g · ' + materials[p.key][0]; $('wasteItem').textContent = materials[p.key][1];
  $('vendScreenSmall').textContent = 'Available demo balance: ' + state.balance + ' pts';
  $('wasteType').value = p.key; $('weightInput').value = p.grams;
}
async function runDeposit() {
  if (busy || state.pending) return toast('Finish or reset the current deposit first.');
  const key = $('wasteType').value, grams = Number($('weightInput').value), m = materials[key];
  if (!m || !Number.isInteger(grams) || grams < 1 || grams > 5000) return toast('Choose a supported material and a whole-number weight from 1 to 5,000 grams.');
  const points = Math.floor(grams * m[3]);
  if (points < 1) return toast(`This sample earns 0 points. Use at least ${Math.ceil(1 / m[3])} grams of ${m[0]}.`);
  const operation = {}; busy = operation; inputs(true); $('runBtn').disabled = true; $('wasteItem').textContent = m[1];
  const updates = [['IDENTIFYING · DEMO', 'QR identity recognized'], ['CLASSIFYING · DEMO', m[0]], ['WEIGHING · DEMO', grams + ' grams'], ['SORTING · DEMO', m[2] + ' compartment']];
  for (let i = 0; i < updates.length; i++) {
    state.step = i; renderSteps(); $('wasteScreenTitle').textContent = updates[i][0]; $('wasteScreenBig').textContent = updates[i][1];
    await new Promise(resolve => setTimeout(resolve, 780)); if (busy !== operation) return;
  }
  // A completed deposit earns credit before the optional redemption choice.
  const id = 'DEMO-' + crypto.randomUUID(); state.pending = { key, grams, points, id };
  state.balance += points; state.points += points; state.waste += grams / 1000; state.count++;
  state.ledger.unshift({ id, name: m[0], emoji: m[1], grams, points, createdAt: new Date().toISOString(), status: 'SAVED · CHOICE OPEN' });
  state.activity.unshift({ icon: m[1], title: 'Deposit · ' + m[0], detail: grams + ' g · credited to demo wallet', delta: '+' + points });
  busy = false; showPending(); render(true);
}
function credit() {
  if (!state.pending) return;
  const row = state.ledger.find(x => x.id === state.pending.id); if (row) row.status = 'SAVED';
  state.pending = null; state.step = 0; ready(); render(true); toast('Points saved to the demo wallet.');
}
function openRewards() {
  if (busy) return toast('Wait for the deposit to finish.');
  state.selected = null; $('confirmRedeem').disabled = true; $('confirmRedeem').textContent = 'Choose a reward';
  $('rewardBalance').textContent = state.balance + ' demo points available. Unaffordable and out-of-stock rewards cannot be selected.';
  $('products').innerHTML = catalog.map((p, i) => `<button type="button" class="product" data-i="${i}" ${p.stock <= 0 || p.cost > state.balance ? 'disabled' : ''}><span class="emoji">${p.emoji}</span><span class="product-info"><b>${p.name}</b><small>${p.stock <= 0 ? 'Out of stock' : p.cost > state.balance ? 'Need ' + (p.cost - state.balance) + ' more points · ' + p.stock + ' in stock' : p.stock + ' simulated in stock'}</small></span><span class="product-price">${p.cost} pts</span></button>`).join('');
  document.querySelectorAll('.product').forEach(el => el.onclick = () => {
    const i = Number(el.dataset.i), p = catalog[i]; if (p.stock <= 0 || p.cost > state.balance) return;
    state.selected = i; document.querySelectorAll('.product').forEach(e => e.classList.remove('selected')); el.classList.add('selected');
    $('confirmRedeem').disabled = false; $('confirmRedeem').textContent = 'Redeem · ' + p.cost + ' pts';
  });
  $('modal').classList.add('show'); $('cancelModal').focus();
}
function closeRewards() { $('modal').classList.remove('show'); state.selected = null; }
$('runBtn').onclick = runDeposit; $('saveBtn').onclick = credit; $('redeemBtn').onclick = openRewards; $('walletRewards').onclick = openRewards;
$('cancelModal').onclick = closeRewards; $('modal').onclick = e => { if (e.target === $('modal')) closeRewards(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRewards(); });
$('confirmRedeem').onclick = () => {
  if (state.selected === null) return; const p = catalog[state.selected];
  if (p.stock <= 0) return toast('This demo reward is out of stock.');
  if (p.cost > state.balance) return toast('Need ' + (p.cost - state.balance) + ' more points.');
  // Spend through the same store used by the website Rewards Store.
  try {
    persist(); demo.redeem('demo-' + state.selected, crypto.randomUUID());
    const saved = demo.read(); state = saved.state; catalog.forEach((p, i) => p.stock = saved.stock[i]);
    state.pending = null; state.step = 0; closeRewards(); ready();
    $('vendScreenTitle').textContent = 'VEND COMPLETE · DEMO'; $('vendScreenBig').textContent = p.emoji + ' ' + p.name;
    render(true); toast(p.name + ' redeemed. Demo inventory updated.');
  } catch (e) { toast(e.message); }
};
$('resetBtn').onclick = () => {
  busy = false; closeRewards(); const mode = state.mode; state = fresh(); state.mode = mode;
  catalog.forEach((p, i) => p.stock = initialStock[i]); ready(); render(true); quote(); toast('Demo history, wallet and inventory reset.');
};
function setMode(mode) {
  state.mode = mode; document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('scene').classList.toggle('only-waste', mode === 'waste'); $('scene').classList.toggle('only-vending', mode === 'vending'); persist();
}
document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('wasteType').innerHTML = Object.entries(materials).map(([key, m]) => `<option value="${key}">${m[0]}</option>`).join('');
$('wasteType').onchange = quote; $('weightInput').oninput = quote;
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue !== JSON.stringify({ version: 2, state, stock: catalog.map(p => p.stock) })) location.reload();
});
window.addEventListener('pagehide', () => { busy = false; });
function tick() { $('clock').textContent = new Date().toLocaleTimeString([], { hour12: false }); }
ready(); if (state.pending) showPending(); else state.step = 0;
setMode(state.mode); quote(); tick(); setInterval(tick, 1000); render();
