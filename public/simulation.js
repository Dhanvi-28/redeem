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
const mechanismStages = {
  idle: ['00 / STANDBY', 'Follow the journey of an item', 'Choose a material and weight, then run a deposit. Explore any stage below without changing points or inventory.'],
  identify: ['01 / IDENTIFY', 'Bind a deposit to the citizen', 'The simulated QR / RFID reader identifies the demo wallet. Identification alone awards no points.'],
  inspect: ['02 / INSPECT', 'Inspect and classify the item', 'The camera and light illuminate the item. This demo uses the selected material as its illustrative classification; it does not run a live AI model.'],
  weigh: ['03 / WEIGH', 'Let the load cell settle', 'The plate settles before its simulated weight is accepted. The reward uses whole grams, with a limit of 5,000 g and a minimum that earns at least one point.'],
  sort: ['04 / SORT', 'Route the item to its material bin', 'The conveyor moves the item to a servo-controlled diverter. The selected stream opens; other streams stay closed. Bin bars below show cumulative demo weight, not physical fill sensors.'],
  credit: ['05 / POINTS', 'Calculate once, then credit the wallet', 'Points = floor(weight in grams × the material rate per kg ÷ 1,000). A completed deposit creates one credit. Save keeps those points available; changing views never credits it again.'],
  vend: ['06 / VEND', 'Authorize, dispense and record', 'The reward engine checks balance and stock, deducts the product price, and authorizes a simulated motor. One stock item is removed and a redemption is recorded. No physical product is dispensed.'],
};
let mechanicalCycle = state.pending || state.lastCycle || null, mechanismStage = 'idle';
function updateMechanics(stage = mechanismStage, cycle = mechanicalCycle) {
  mechanismStage = stage; mechanicalCycle = cycle;
  const key = cycle?.key || $('wasteType').value || 'pet', m = materials[key] || materials.pet;
  const grams = cycle?.grams ?? Number($('weightInput').value), valid = Number.isInteger(grams) && grams > 0 && grams <= 5000;
  const points = valid ? Math.floor(grams * m[3]) : 0, detail = mechanismStages[stage] || mechanismStages.idle;
  $('inside-view').setAttribute('data-stage', stage); $('scene').setAttribute('data-stage', stage);
  $('mechanism-status').textContent = busy ? 'Cycle running · ' + detail[1] : stage === 'idle' ? 'Ready for an item' : 'Simulation · ' + detail[1];
  $('inside-stage-number').textContent = detail[0]; $('inside-stage-title').textContent = detail[1]; $('inside-stage-detail').textContent = detail[2];
  $('inside-view').style.setProperty('--bin-offset-x', (70 + Object.keys(materials).indexOf(key) * 51 - 224) + 'px');
  $('inside-item').textContent = m[1]; $('inside-weight').textContent = stage === 'weigh' || stage === 'sort' || stage === 'credit' ? (valid ? grams : 0) + ' g' : '— g';
  $('inside-wallet').textContent = state.balance + ' pts'; $('formula-weight').textContent = valid ? grams + ' g' : 'Invalid weight';
  $('formula-rate').textContent = (m[3] * 1000) + ' pts'; $('formula-result').textContent = points + ' pts';
  const accepted = Boolean(cycle?.id && state.ledger.some(row => row.id === cycle.id));
  $('calculation-state').textContent = accepted ? 'CREDIT RECORDED' : 'ESTIMATE · NOT CREDITED';
  $('formula-explanation').textContent = valid ? 'floor(' + grams + ' × ' + (m[3] * 1000) + ' ÷ 1,000) = ' + points + ' points · ' + m[0] + (accepted ? '. This credit is already in the shared ledger.' : '. Only a completed accepted deposit adds this credit.') : 'Enter a whole-number weight from 1 to 5,000 grams.';
  const latestReward = state.redemptions?.[0];
  $('inside-redemption').textContent = latestReward ? latestReward.rewardName + ': ' + latestReward.pointsSpent + ' points spent · one demo stock item removed. Available now: ' + state.balance + ' points.' : 'No reward redeemed yet. Save keeps all credited points available.';
  $('engine-earned').textContent = state.points; $('engine-spent').textContent = state.points - state.balance; $('engine-balance').textContent = state.balance;
  $('inside-bins').innerHTML = Object.entries(materials).map(([material, info], index) => {
    const weight = state.ledger.filter(row => row.name === info[0]).reduce((sum, row) => sum + row.grams, 0);
    const fill = Math.min(30, weight / 5000 * 30), x = 48 + index * 51;
    return '<g class="inside-bin '+(material === key ? 'selected' : '')+'"><title>'+escape(info[0])+': '+weight+' g accepted in this demo</title><rect x="'+x+'" y="344" width="44" height="40" rx="4" fill="#c9d9c8" stroke="#a1b79e"/><rect class="bin-fill" x="'+(x+3)+'" y="'+(381-fill)+'" width="38" height="'+fill+'" rx="2"/><text x="'+(x+22)+'" y="398" text-anchor="middle" class="svg-small">'+info[2]+'</text></g>';
  }).join('');
  document.querySelectorAll('[data-explain]').forEach(button => { button.disabled = Boolean(busy); button.classList.toggle('active', button.dataset.explain === stage); button.setAttribute('aria-pressed', String(button.dataset.explain === stage)); });
}
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
  renderSteps(); updateMechanics(); persist(activate);
}
function enableChoices(on) { $('choices').classList.toggle('hidden', !on); $('runBtn').classList.toggle('hidden', on); }
function inputs(disabled) { $('wasteType').disabled = $('weightInput').disabled = disabled; }
function quote() {
  if (!busy && !state.pending) updateMechanics('idle', null);
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
  $('wasteType').value = p.key; $('weightInput').value = p.grams; updateMechanics('credit', p);
}
async function runDeposit() {
  if (busy || state.pending) return toast('Finish or reset the current deposit first.');
  const key = $('wasteType').value, grams = Number($('weightInput').value), m = materials[key];
  if (!m || !Number.isInteger(grams) || grams < 1 || grams > 5000) return toast('Choose a supported material and a whole-number weight from 1 to 5,000 grams.');
  const points = Math.floor(grams * m[3]);
  if (points < 1) return toast(`This sample earns 0 points. Use at least ${Math.ceil(1 / m[3])} grams of ${m[0]}.`);
  const operation = {}; busy = operation; mechanicalCycle = { key, grams, points };
  updateMechanics('identify', mechanicalCycle); inputs(true); $('runBtn').disabled = true; $('wasteItem').textContent = m[1];
  const updates = [['IDENTIFYING · DEMO', 'QR identity recognized'], ['CLASSIFYING · DEMO', m[0]], ['WEIGHING · DEMO', grams + ' grams'], ['SORTING · DEMO', m[2] + ' compartment']];
  for (let i = 0; i < updates.length; i++) {
    state.step = i; updateMechanics(['identify', 'inspect', 'weigh', 'sort'][i], mechanicalCycle); renderSteps(); $('wasteScreenTitle').textContent = updates[i][0]; $('wasteScreenBig').textContent = updates[i][1];
    await new Promise(resolve => setTimeout(resolve, 1400)); if (busy !== operation) return;
  }
  // A completed deposit earns credit before the optional redemption choice.
  const id = 'DEMO-' + crypto.randomUUID(); state.pending = { key, grams, points, id }; state.lastCycle = { ...state.pending };
  state.balance += points; state.points += points; state.waste += grams / 1000; state.count++;
  state.ledger.unshift({ id, name: m[0], emoji: m[1], grams, points, createdAt: new Date().toISOString(), status: 'SAVED · CHOICE OPEN' });
  state.activity.unshift({ icon: m[1], title: 'Deposit · ' + m[0], detail: grams + ' g · credited to demo wallet', delta: '+' + points });
  busy = false; showPending(); updateMechanics('credit', state.lastCycle); render(true);
}
function credit() {
  if (!state.pending) return;
  const row = state.ledger.find(x => x.id === state.pending.id); if (row) row.status = 'SAVED';
  state.pending = null; state.step = 0; ready(); updateMechanics('credit', state.lastCycle); render(true); toast('Points saved to the demo wallet.');
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
  if (state.selected === null) return; const selectedIndex = state.selected, p = catalog[selectedIndex];
  if (p.stock <= 0) return toast('This demo reward is out of stock.');
  if (p.cost > state.balance) return toast('Need ' + (p.cost - state.balance) + ' more points.');
  // Spend through the same store used by the website Rewards Store.
  try {
    persist(); demo.redeem('demo-' + state.selected, crypto.randomUUID());
    const saved = demo.read(); state = saved.state; catalog.forEach((p, i) => p.stock = saved.stock[i]);
    state.pending = null; state.step = 0; closeRewards(); ready();
    document.querySelectorAll('[data-product]').forEach(item => item.classList.toggle('is-dispensing', Number(item.dataset.product) === selectedIndex));
    $('inside-product').textContent = p.emoji; updateMechanics('vend', state.lastCycle);
    $('vendScreenTitle').textContent = 'VEND COMPLETE · DEMO'; $('vendScreenBig').textContent = p.emoji + ' ' + p.name;
    render(true); toast(p.name + ' redeemed. Demo inventory updated.');
  } catch (e) { toast(e.message); }
};
$('resetBtn').onclick = () => {
  busy = false; closeRewards(); const mode = state.mode; state = fresh(); state.mode = mode;
  mechanicalCycle = null; mechanismStage = 'idle';
  catalog.forEach((p, i) => p.stock = initialStock[i]); ready(); render(true); quote(); toast('Demo history, wallet and inventory reset.');
};
function setMode(mode) {
  if (!['both', 'waste', 'vending', 'inside'].includes(mode)) mode = 'both';
  state.mode = mode; document.querySelectorAll('.mode-btn').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  $('exterior-view').hidden = mode === 'inside'; $('inside-view').hidden = mode !== 'inside';
  updateMechanics();
  $('scene').classList.toggle('only-waste', mode === 'waste'); $('scene').classList.toggle('only-vending', mode === 'vending'); persist();
}
document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('productShelf').innerHTML = catalog.map((p, i) => '<div class="snack" data-product="' + i + '" title="' + escape(p.name) + '">' + p.emoji + '</div>').join('');
$('wasteType').innerHTML = Object.entries(materials).map(([key, m]) => `<option value="${key}">${m[0]}</option>`).join('');
document.querySelectorAll('[data-explain]').forEach(button => button.onclick = () => { if (busy) return; updateMechanics(button.dataset.explain, state.pending || state.lastCycle || null); });
$('wasteType').onchange = quote; $('weightInput').oninput = quote;
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue !== JSON.stringify({ version: 2, state, stock: catalog.map(p => p.stock) })) location.reload();
});
window.addEventListener('pagehide', () => { busy = false; });
function tick() { $('clock').textContent = new Date().toLocaleTimeString([], { hour12: false }); }
ready(); if (state.pending) showPending(); else state.step = 0;
setMode(state.mode); quote(); tick(); setInterval(tick, 1000); render();

// Keep the embedded twin tall enough for the cutaway and its reward explanation.
if (typeof ResizeObserver !== 'undefined' && window.parent !== window) {
  const shell = document.querySelector('.shell');
  const sizeObserver = new ResizeObserver(() => window.parent.postMessage({ type: 'ecosync-twin-size', height: Math.ceil(shell.getBoundingClientRect().height) + 8 }, location.origin));
  sizeObserver.observe(shell);
  window.addEventListener('pagehide', () => sizeObserver.disconnect());
}
