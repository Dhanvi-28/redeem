// Shared, explicitly simulated data. This module never sends account API writes.
window.EcoDemo = (() => {
  const key = 'ecosync:twin:v2', modeKey = 'ecosync:data-mode';
  const catalog = [
    { name: 'Instant noodles', emoji: '🍜', cost: 80, stock: 4 }, { name: 'Snack pack', emoji: '🥨', cost: 60, stock: 6 },
    { name: 'Biscuit pack', emoji: '🍪', cost: 50, stock: 5 }, { name: 'Juice box', emoji: '🧃', cost: 70, stock: 3 },
    { name: 'Pencil set', emoji: '✏️', cost: 40, stock: 5 }, { name: 'Notebook', emoji: '📓', cost: 100, stock: 5 },
    { name: 'Reusable tote bag', emoji: '🛍️', cost: 180, stock: 3 }, { name: 'Reusable water bottle', emoji: '💧', cost: 250, stock: 3 },
  ];
  const fresh = () => ({ balance: 0, waste: 0, points: 0, count: 0, ledger: [], activity: [], redemptions: [], pending: null, step: 0, mode: 'both', selected: null });
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  function read() {
    const empty = { version: 2, state: fresh(), stock: catalog.map(p => p.stock) };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null'), s = saved?.state;
      if (!s || saved.version !== 2 || ![s.balance, s.points, s.count].every(valid) || !Number.isFinite(s.waste) || s.waste < 0 || !Array.isArray(s.ledger) || !s.ledger.every(r => r && typeof r.id === 'string' && valid(r.points) && valid(r.grams)) || !Array.isArray(s.activity) || !s.activity.every(r => r && typeof r.title === 'string') || !Array.isArray(saved.stock) || !saved.stock.every(valid)) return empty;
      // Older twin versions recorded rewards only in activity. Preserve those
      // outcomes without inventing timestamps that were never recorded.
      const legacy = s.activity.filter(r => r.title.startsWith('Reward · ') && /^[−-]\d+$/.test(String(r.delta))).map((r, i) => ({
        _id: 'DEMO-legacy-' + i, rewardName: r.title.slice('Reward · '.length), pointsSpent: Number(String(r.delta).slice(1)), machineId: 'DEMO-VENDING', status: 'simulated_dispense', createdAt: null,
      }));
      return { version: 2, state: { ...fresh(), ...s, redemptions: Array.isArray(s.redemptions) ? s.redemptions.filter(r => r && typeof r._id === 'string' && valid(r.pointsSpent)) : legacy }, stock: catalog.map((p, i) => saved.stock[i] ?? p.stock) };
    } catch { return empty; }
  }
  function write(snapshot, activate = false) {
    localStorage.setItem(key, JSON.stringify(snapshot));
    if (activate) localStorage.setItem(modeKey, 'demo');
    window.dispatchEvent(new Event('ecosync-demo-change'));
  }
  function active() { try { return localStorage.getItem(modeKey) === 'demo'; } catch { return false; } }
  function setMode(mode) { localStorage.setItem(modeKey, mode === 'demo' ? 'demo' : 'real'); window.dispatchEvent(new Event('ecosync-demo-change')); }
  function data() {
    const snapshot = read(), s = snapshot.state;
    const deposits = s.ledger.map(r => ({ _id: r.id, category: r.name, weightGrams: r.grams, points: r.points, machineId: 'DEMO-WASTE', validation: 'simulated', createdAt: r.createdAt || null }));
    const redemptions = s.redemptions;
    const spent = s.points - s.balance;
    const wallet = { balance: s.balance, earned: s.points, spent };
    const transactions = [...deposits.map(r => ({ _id: r._id, type: 'simulated_deposit', delta: r.points, createdAt: r.createdAt })), ...redemptions.map(r => ({ _id: r._id, type: 'simulated_redemption', delta: -r.pointsSpent, createdAt: r.createdAt }))].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const rewards = catalog.map((p, i) => ({ _id: 'demo-' + i, name: p.name, description: 'Digital twin reward · simulated inventory and dispensing.', pointsPrice: p.cost, stock: snapshot.stock[i], active: true, machineId: null, version: 0 }));
    return { snapshot, wallet, deposits, redemptions, transactions, rewards, spent };
  }
  function redeem(rewardId, requestKey) {
    const d = data(), prior = d.redemptions.find(r => r.key === requestKey);
    if (prior) { if (prior.rewardId !== rewardId) throw new Error('Request key already used.'); return prior; }
    const index = catalog.findIndex((p, i) => 'demo-' + i === rewardId), reward = d.rewards[index];
    if (!reward || reward.stock < 1) throw new Error('Demo reward is out of stock.');
    if (d.wallet.balance < reward.pointsPrice) throw new Error('Insufficient demo points.');
    const record = { _id: 'DEMO-' + crypto.randomUUID(), key: requestKey, rewardId, rewardName: reward.name, pointsSpent: reward.pointsPrice, machineId: 'DEMO-VENDING', status: 'simulated_dispense', createdAt: new Date().toISOString() };
    const s = d.snapshot.state; s.balance -= reward.pointsPrice; s.redemptions.unshift(record); d.snapshot.stock[index]--;
    if (s.pending) { const row = s.ledger.find(r => r.id === s.pending.id); if (row) row.status = 'REDEEMED'; }
    s.pending = null; s.step = 0; s.selected = null;
    s.activity.unshift({ icon: catalog[index].emoji, title: 'Reward · ' + reward.name, detail: 'Simulated vend · ' + reward.pointsPrice + ' pts', delta: '−' + reward.pointsPrice });
    write(d.snapshot, true); return record;
  }
  async function api(path, options = {}) {
    const [route, query] = path.split('?'), d = data(), offset = Math.max(0, parseInt(new URLSearchParams(query).get('offset'), 10) || 0);
    const rows = list => list.slice(offset, offset + 50);
    if (route === '/dashboard') return { wallet: d.wallet, deposits: d.deposits.slice(0, 10), redemptions: d.redemptions.slice(0, 10), depositCount: d.deposits.length, weightGrams: Math.round(d.snapshot.state.waste * 1000) };
    if (route === '/wallet') return { wallet: d.wallet, transactions: rows(d.transactions) };
    if (route === '/deposits' || route === '/admin/deposits') return rows(d.deposits);
    if (route === '/redemptions' || route === '/admin/redemptions') return rows(d.redemptions);
    if (route === '/rewards' || route === '/admin/rewards') return d.rewards;
    if (route === '/rewards/redeem') return redeem(options.body.rewardId, options.key);
    if (route.startsWith('/redemptions/by-key/')) { const record = d.redemptions.find(r => r.key === decodeURIComponent(route.split('/').at(-1))); if (record) return record; const error = new Error('No demo redemption for this key.'); error.status = 404; throw error; }
    if (route === '/admin/overview') return { users: 1, deposits: d.deposits.length, weightGrams: Math.round(d.snapshot.state.waste * 1000), pointsIssued: d.wallet.earned, pointsSpent: d.spent, pendingRedemptions: 0 };
    if (route === '/admin/twin') return { machines: [
      { machineId: 'DEMO-WASTE', name: 'Simulated waste unit', type: 'waste_deposit', pairedMachineId: 'DEMO-VENDING', integrationStatus: 'simulated', enabled: true, inventory: [], pendingDispenses: 0, lastDeposit: d.deposits[0] ? { ...d.deposits[0], measuredAt: d.deposits[0].createdAt } : null },
      { machineId: 'DEMO-VENDING', name: 'Simulated product unit', type: 'product_vending', integrationStatus: 'simulated', enabled: true, inventory: d.rewards, pendingDispenses: 0 },
    ], events: d.deposits.map(r => ({ machineId: r.machineId, eventId: r._id, kind: 'simulated_deposit', createdAt: r.createdAt })) };
    throw new Error('This action is unavailable in demo data mode. Switch to account data for operations configuration.');
  }
  const routes = ['/dashboard', '/wallet', '/deposits', '/redemptions', '/rewards', '/admin/overview', '/admin/twin', '/admin/deposits', '/admin/redemptions', '/admin/rewards'];
  return { key, modeKey, catalog, fresh, read, write, active, setMode, data, redeem, api, handles: path => routes.some(route => path.split('?')[0] === route || path.startsWith(route + '/')) };
})();
