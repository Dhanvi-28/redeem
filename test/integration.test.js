import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { startMongo } from '../scripts/mongo-process.js';
import { connectDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { identityCrypto } from '../server/security.js';

let client, db, mongod, app, owner, other, admin, wasteCredential, vendCredential, ownerId, qrToken;
const identityKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:3000';
const write = (agent, path, body, method = 'post') => agent[method](path).set('Origin', origin).send(body);
const controller = (path, body, credential = wasteCredential) => request(app).post('/api/machine' + path).set('Authorization', 'Bearer ' + credential).send(body);
const password = 'test-Only-Passphrase-2026';
async function newSession() {
  const r = await controller('/identify', { qrToken }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.sessionId;
}
async function deposit(eventId, extra = {}) {
  const body = { eventId, sessionId: await newSession(), category: 'pet', weightGrams: 1000, confidence: .96, stable: true, sorted: true, modelVersion: 'isolated-test-model', classificationId: 'isolated-test-classification', measuredAt: new Date().toISOString(), ...extra };
  return { body, response: await controller('/deposits', body) };
}
async function addReward(extra = {}) {
  const r = await write(admin, '/api/admin/rewards', { name: 'Isolated test reward', description: 'Test fixture only', pointsPrice: 20, stock: 5, active: true, machineId: null, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body._id;
}
before(async () => {
  mkdirSync('.local/tests', { recursive: true });
  const local = await startMongo({ directory: mkdtempSync(join(resolve('.local/tests'), 'run-')), port: 27119, replicaSet: 'ecosync_test' }); mongod = local.child;
  ({ db, client } = await connectDatabase(local.uri.replace('/ecosync?', '/ecosync_test?')));
  await db.dropDatabase();
  // Rebuild indexes in the isolated database after clearing a prior interrupted test.
  await client.close(); ({ db, client } = await connectDatabase(local.uri.replace('/ecosync?', '/ecosync_test?')));
  app = createApp({ db, client, config: { identityKey, frontendUrl: origin, test: true } });
  owner = request.agent(app); other = request.agent(app); admin = request.agent(app);
  const r = await write(owner, '/api/auth/register', { name: 'Fixture Citizen', email: 'Citizen@Test.invalid', password });
  assert.equal(r.status, 201, JSON.stringify(r.body)); ownerId = r.body._id;
  await write(other, '/api/auth/register', { name: 'Fixture Other', email: 'other@test.invalid', password }).expect(201);
  const a = await write(admin, '/api/auth/register', { name: 'Fixture Admin', email: 'admin@test.invalid', password });
  const adminRecord = await db.collection('users').findOne({ email: a.body.email });
  await db.collection('users').updateOne({ _id: adminRecord._id }, { $set: { role: 'admin' } });
  const qr = await db.collection('qrIdentities').findOne({ userId: (await db.collection('users').findOne({ email: 'citizen@test.invalid' }))._id });
  qrToken = identityCrypto(identityKey).decrypt(qr.encryptedToken);
  const w = await write(admin, '/api/admin/machines', { machineId: 'test-waste', name: 'Isolated waste fixture', type: 'waste_deposit', pairedMachineId: 'test-vending', categories: [{ category: 'pet', pointsPerKg: 100, maxWeightGrams: 5000, minConfidence: .8 }] });
  assert.equal(w.status, 201, JSON.stringify(w.body)); wasteCredential = w.body.credential;
  const v = await write(admin, '/api/admin/machines', { machineId: 'test-vending', name: 'Isolated vending fixture', type: 'product_vending' });
  assert.equal(v.status, 201); vendCredential = v.body.credential;
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); if (mongod) mongod.kill(); });

test('new accounts have zero balance, empty histories and no fabricated AI result', async () => {
  const r = await owner.get('/api/dashboard'); assert.equal(r.status, 200);
  assert.deepEqual(r.body.wallet, { balance: 0, earned: 0, spent: 0 }); assert.equal(r.body.depositCount, 0); assert.deepEqual(r.body.redemptions, []);
  await write(owner, '/api/scan', { image: 'fake', mimeType: 'image/png' }).expect(503);
  assert.equal((await owner.get('/api/rewards')).body.length, 0);
});
test('permanent QR survives profile changes and logout/login; unique identities and email', async () => {
  const first = await owner.get('/api/me/qr'); assert.equal(first.status, 200);
  assert.ok(first.body.image.startsWith('data:image/png;base64,')); assert.equal(first.body.tokenHash, undefined);
  await write(owner, '/api/me', { name: 'Changed Fixture' }, 'patch').expect(200);
  await write(owner, '/api/auth/logout', {}).expect(200); await owner.get('/api/me').expect(401);
  await write(owner, '/api/auth/login', { email: 'CITIZEN@test.invalid', password }).expect(200);
  assert.equal((await owner.get('/api/me/qr')).body.image, first.body.image);
  assert.notEqual((await other.get('/api/me/qr')).body.image, first.body.image);
  await write(request(app), '/api/auth/register', { name: 'Duplicate', email: 'CITIZEN@test.invalid', password }).expect(409);
  const identities = await db.collection('qrIdentities').find().toArray();
  assert.equal(new Set(identities.map(x => x.tokenHash)).size, identities.length);
  await assert.rejects(db.collection('qrIdentities').insertOne({ ...identities[0], _id: undefined }), { code: 11000 });
});
test('authorization, CSRF and client values cannot bypass server checks', async () => {
  await request(app).get('/api/wallet').expect(401);
  await owner.get('/api/admin/twin').expect(403);
  await owner.post('/api/me').send({ name: 'No origin' }).expect(403);
  await write(owner, '/api/rewards/redeem', { rewardId: 'invalid', points: 999 }).set('Idempotency-Key', 'invalid-key').expect(422);
  await controller('/identify', { qrToken }, 'invalid').expect(401);
  await controller('/deposits', { userId: ownerId, points: 100000 }).expect(422);
  await write(request(app), '/api/auth/login', { email: 'citizen@test.invalid', password: qrToken }).expect(401);
});
test('only authenticated stable accepted deposits credit; concurrent duplicates credit once', async () => {
  const { body, response } = await deposit('deposit-first'); assert.equal(response.status, 200, JSON.stringify(response.body));
  const results = await Promise.all(Array.from({ length: 5 }, () => controller('/deposits', body)));
  assert.ok(results.every(r => r.status === 200));
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, 100);
  assert.equal((await other.get(`/api/deposits?userId=${ownerId}`)).body.length, 0);
  await controller('/deposits', { ...body, weightGrams: 2000 }).expect(409);
  const next = { ...body, eventId: 'deposit-reuse-session' }; await controller('/deposits', next).expect(409);
  const low = await deposit('deposit-low-confidence', { confidence: .2 }); assert.equal(low.response.status, 422);
  const unstable = await deposit('deposit-unstable', { stable: false }); assert.equal(unstable.response.status, 422);
  const stale = await deposit('deposit-stale', { measuredAt: new Date(Date.now() - 600000).toISOString() }); assert.equal(stale.response.status, 422);
  assert.equal((await owner.get('/api/wallet')).body.transactions.length, 1);
});
test('server price, inventory and balance: concurrent redemptions cannot overspend or oversell', async () => {
  const rewardId = await addReward({ stock: 1, pointsPrice: 60 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', `race-key-${i}`)));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.every(r => [200, 409].includes(r.status)), JSON.stringify(results.map(r => r.body)));
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, 40);
  const tooExpensive = await addReward({ pointsPrice: 1000 });
  await write(owner, '/api/rewards/redeem', { rewardId: tooExpensive }).set('Idempotency-Key', 'insufficient-points').expect(409);
});
test('concurrent retry returns one order; confirmed website cancellation refunds exactly once', async () => {
  const rewardId = await addReward();
  const results = await Promise.all(Array.from({ length: 5 }, () => write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', 'same-order-key')));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.body)));
  assert.equal(new Set(results.map(r => r.body._id)).size, 1); const id = results[0].body._id;
  assert.equal(results[0].body.status, 'pending_fulfillment');
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, 20);
  const different = await addReward();
  await write(owner, '/api/rewards/redeem', { rewardId: different }).set('Idempotency-Key', 'same-order-key').expect(409);
  await controller(`/redemptions/${id}/outcome`, { eventId: 'invalid-order-outcome', status: 'dispensed' }, vendCredential).expect(404);
  const refunds = await Promise.all(Array.from({ length: 5 }, () => write(admin, `/api/admin/redemptions/${id}/outcome`, { status: 'failed' })));
  assert.ok(refunds.every(r => r.status === 200));
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, 40);
  const ledger = (await owner.get('/api/wallet')).body.transactions;
  assert.equal(ledger.filter(x => x.redemptionId === id && x.type === 'refund').length, 1);
  await write(admin, `/api/admin/redemptions/${id}/outcome`, { status: 'fulfilled' }).expect(409);
});
test('two-unit flow activates only connected vending, sends stable command, refunds failed dispense', async () => {
  const { response: dep } = await deposit('deposit-vending-flow'); assert.equal(dep.status, 200);
  await controller(`/deposits/${dep.body._id}/choice`, { choice: 'redeem' }).expect(503);
  await controller('/events', { eventId: 'vending-heartbeat-one', observedAt: new Date().toISOString() }, vendCredential).expect(200);
  const choice = await controller(`/deposits/${dep.body._id}/choice`, { choice: 'redeem' }); assert.equal(choice.status, 200, JSON.stringify(choice.body));
  const repeat = await controller(`/deposits/${dep.body._id}/choice`, { choice: 'redeem' }); assert.equal(repeat.body.sessionId, choice.body.sessionId);
  const rewardId = await addReward({ machineId: 'test-vending' });
  await write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', 'web-station-order').expect(409);
  const body = { sessionId: choice.body.sessionId, rewardId };
  const red = await controller('/redeem', body, vendCredential).set('Idempotency-Key', 'machine-order-one'); assert.equal(red.status, 200, JSON.stringify(red.body));
  assert.equal(red.body.status, 'awaiting_dispense');
  const commands = await request(app).get('/api/machine/commands').set('Authorization', 'Bearer ' + vendCredential);
  assert.equal(commands.body.commands[0].commandId, red.body._id);
  await controller('/redeem', body, vendCredential).set('Idempotency-Key', 'machine-order-two').expect(409);
  await write(admin, `/api/admin/redemptions/${red.body._id}/outcome`, { status: 'failed' }).expect(409);
  const beforeBalance = (await owner.get('/api/wallet')).body.wallet.balance;
  const failed = { eventId: 'failed-dispense-one', status: 'failed' };
  await controller(`/redemptions/${red.body._id}/outcome`, failed, vendCredential).expect(200);
  await controller(`/redemptions/${red.body._id}/outcome`, failed, vendCredential).expect(200);
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, beforeBalance + 20);
  await controller(`/redemptions/${red.body._id}/outcome`, { eventId: 'conflicting-outcome', status: 'dispensed' }, vendCredential).expect(409);
});
test('save choice keeps credit; successful dispense requires assigned unit confirmation', async () => {
  const saved = await deposit('deposit-save-one');
  await controller(`/deposits/${saved.response.body._id}/choice`, { choice: 'save' }).expect(200);
  await controller(`/deposits/${saved.response.body._id}/choice`, { choice: 'redeem' }).expect(409);
  const dep = await deposit('deposit-success-vend');
  const choice = await controller(`/deposits/${dep.response.body._id}/choice`, { choice: 'redeem' });
  const rewardId = await addReward({ machineId: 'test-vending' });
  const red = await controller('/redeem', { sessionId: choice.body.sessionId, rewardId }, vendCredential).set('Idempotency-Key', 'successful-vend-key');
  assert.equal(red.status, 200);
  await controller(`/redemptions/${red.body._id}/outcome`, { status: 'dispensed', eventId: 'wrong-controller' }).expect(404);
  await controller(`/redemptions/${red.body._id}/outcome`, { status: 'dispensed', eventId: 'successful-vend-event' }, vendCredential).expect(200);
  assert.equal((await owner.get('/api/redemptions')).body.find(x => x._id === red.body._id).status, 'dispensed');
});
test('twin state derives from persisted authenticated telemetry; replay and out-of-order events cannot forge freshness', async () => {
  const body = { eventId: 'telemetry-waste-one', observedAt: new Date().toISOString(), compartments: [{ category: 'pet', fillPercent: 42 }], alert: null };
  await controller('/events', body).expect(200);
  const first = (await admin.get('/api/admin/twin')).body;
  const m = first.machines.find(x => x.machineId === 'test-waste'); assert.equal(m.connected, true); assert.equal(m.compartments[0].fillPercent, 42); assert.equal(m.credentialHash, undefined);
  await controller('/events', body).expect(200);
  const again = (await admin.get('/api/admin/twin')).body.machines.find(x => x.machineId === 'test-waste'); assert.equal(again.lastSeenAt, m.lastSeenAt);
  await controller('/events', { ...body, compartments: [{ category: 'pet', fillPercent: 1 }] }).expect(409);
  await controller('/events', { ...body, eventId: 'telemetry-older-one', observedAt: new Date(Date.now() - 30000).toISOString(), compartments: [{ category: 'pet', fillPercent: 2 }] }).expect(200);
  assert.equal((await admin.get('/api/admin/twin')).body.machines.find(x => x.machineId === 'test-waste').compartments[0].fillPercent, 42);
});
test('ledger totals always reconcile to wallet summaries and no citizen gets another account history', async () => {
  const data = (await owner.get('/api/wallet')).body;
  assert.equal(data.transactions.reduce((sum, t) => sum + t.delta, 0), data.wallet.balance);
  assert.equal(data.transactions.filter(t => t.type === 'deposit').reduce((sum, t) => sum + t.delta, 0), data.wallet.earned);
  assert.equal(-data.transactions.filter(t => t.type !== 'deposit').reduce((sum, t) => sum + t.delta, 0), data.wallet.spent);
  assert.equal((await other.get(`/api/wallet?userId=${ownerId}`)).body.wallet.balance, 0);
  assert.deepEqual((await other.get(`/api/redemptions?userId=${ownerId}`)).body, []);
});
test('stale inventory edits cannot overwrite a concurrent reservation', async () => {
  const rewardId = await addReward({ stock: 5 });
  const update = { name: 'Isolated test reward', description: 'Test fixture only', pointsPrice: 20, stock: 5, active: true, machineId: null, version: 0 };
  await write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', 'inventory-edit-race').expect(200);
  await write(admin, `/api/admin/rewards/${rewardId}`, update, 'patch').expect(409);
  const product = (await admin.get('/api/admin/rewards')).body.find(x => x._id === rewardId);
  assert.equal(product.stock, 4); assert.equal(product.version, 1);
  await write(admin, `/api/admin/rewards/${rewardId}`, { ...update, stock: 4, version: 1 }, 'patch').expect(200);
});
test('classifier adapter validates image bytes and actual service responses without crediting points', async () => {
  let calls = 0, invalid = false;
  const fixture = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer isolated-fixture-key');
    calls++; res.setHeader('Content-Type', 'application/json');
    req.resume(); req.on('end', () => res.end(JSON.stringify(invalid ? { confidence: 10 } : { category: 'isolated-fixture-category', confidence: .9, modelVersion: 'isolated-model', guidance: ['Isolated test guidance'] })));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const classifierApp = createApp({ db, client, config: { identityKey, frontendUrl: origin, test: true, aiEndpoint: `http://127.0.0.1:${fixture.address().port}`, aiKey: 'isolated-fixture-key' } });
    const citizen = request.agent(classifierApp);
    await write(citizen, '/api/auth/login', { email: 'citizen@test.invalid', password }).expect(200);
    const balance = (await citizen.get('/api/wallet')).body.wallet.balance;
    await write(citizen, '/api/scan', { mimeType: 'image/png', image: Buffer.from('this is not a png image').toString('base64') }).expect(422);
    assert.equal(calls, 0);
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=';
    const scan = await write(citizen, '/api/scan', { mimeType: 'image/png', image }); assert.equal(scan.status, 200);
    assert.equal(scan.body.modelVersion, 'isolated-model'); assert.equal(scan.body.pointsAwarded, 0); assert.equal(calls, 1);
    invalid = true; await write(citizen, '/api/scan', { mimeType: 'image/png', image }).expect(502);
    assert.equal((await citizen.get('/api/wallet')).body.wallet.balance, balance);
  } finally { await new Promise(resolve => fixture.close(resolve)); }
});

test('interrupted website redemption can be recovered even after stock is exhausted, only by its owner', async () => {
  const rewardId = await addReward({ stock: 1, pointsPrice: 1 });
  const key = 'recover-interrupted-order';
  const placed = await write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', key).expect(200);
  const recovered = await owner.get(`/api/redemptions/by-key/${key}`).expect(200);
  assert.equal(recovered.body._id, placed.body._id);
  assert.equal(recovered.body.key, undefined);
  await other.get(`/api/redemptions/by-key/${key}`).expect(404);
  await request(app).get(`/api/redemptions/by-key/${key}`).expect(401);
  const retry = await write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', key).expect(200);
  assert.equal(retry.body._id, placed.body._id);
});

test('finalized dispense outcomes still reject event IDs belonging to another event', async () => {
  const red = await db.collection('redemptions').findOne({ status: 'dispensed', machineId: 'test-vending' });
  await controller(`/redemptions/${red._id}/outcome`, { eventId: 'vending-heartbeat-one', status: 'dispensed' }, vendCredential).expect(409);
  await controller(`/redemptions/${red._id}/outcome`, { eventId: 'successful-vend-event', status: 'dispensed' }, vendCredential).expect(200);
});

test('twin preserves sensor timestamps across heartbeats and never marks disabled units connected', async () => {
  const before = (await admin.get('/api/admin/twin')).body.machines.find(m => m.machineId === 'test-waste');
  assert.ok(before.compartmentsObservedAt);
  await controller('/events', { eventId: 'heartbeat-no-sensors', observedAt: new Date().toISOString() }).expect(200);
  const after = (await admin.get('/api/admin/twin')).body.machines.find(m => m.machineId === 'test-waste');
  assert.equal(after.compartmentsObservedAt, before.compartmentsObservedAt);
  assert.deepEqual(after.compartments, before.compartments);
  await write(admin, '/api/admin/machines/test-waste', { enabled: false }, 'patch').expect(200);
  const twin = (await admin.get('/api/admin/twin')).body;
  const disabled = twin.machines.find(m => m.machineId === 'test-waste');
  assert.equal(disabled.connected, false); assert.equal(disabled.integrationStatus, 'disabled');
  assert.deepEqual(disabled.categories, before.categories);
  assert.equal(disabled.pairedMachineId, before.pairedMachineId);
  const vending = twin.machines.find(m => m.machineId === 'test-vending');
  assert.ok(vending.inventory.length > 0); assert.equal(vending.pendingDispenses, 0);
  await controller('/identify', { qrToken }).expect(401);
  await write(admin, '/api/admin/machines/test-waste', { enabled: true }, 'patch').expect(200);
});

test('inventory cannot move fulfillment location while orders await delivery or refund', async () => {
  const rewardId = await addReward({ stock: 2, pointsPrice: 1 });
  const order = await write(owner, '/api/rewards/redeem', { rewardId }).set('Idempotency-Key', 'pending-location-edit').expect(200);
  const update = { name: 'Isolated test reward', description: '', pointsPrice: 1, stock: 1, active: true, machineId: 'test-vending', version: 1 };
  await write(admin, `/api/admin/rewards/${rewardId}`, update, 'patch').expect(409);
  await write(admin, `/api/admin/redemptions/${order.body._id}/outcome`, { status: 'failed' }).expect(200);
  await write(admin, `/api/admin/rewards/${rewardId}`, { ...update, stock: 2, version: 2 }, 'patch').expect(200);
});

test('controller recovers the same committed command after redemption session TTL cleanup', async () => {
  await controller('/events', { eventId: 'retry-recovery-heartbeat', observedAt: new Date().toISOString() }, vendCredential).expect(200);
  const dep = await deposit('retry-recovery-deposit');
  const choice = await controller(`/deposits/${dep.response.body._id}/choice`, { choice: 'redeem' }).expect(200);
  const rewardId = await addReward({ machineId: 'test-vending', pointsPrice: 1 });
  const body = { sessionId: choice.body.sessionId, rewardId }, key = 'ttl-recovery-order';
  const first = await controller('/redeem', body, vendCredential).set('Idempotency-Key', key).expect(200);
  await db.collection('redemptionSessions').deleteOne({ _id: body.sessionId });
  const balance = (await owner.get('/api/wallet')).body.wallet.balance;
  const retry = await controller('/redeem', body, vendCredential).set('Idempotency-Key', key).expect(200);
  assert.equal(retry.body._id, first.body._id);
  assert.equal((await owner.get('/api/wallet')).body.wallet.balance, balance);
  await controller('/redeem', body).set('Idempotency-Key', key).expect(404);
  await controller('/redeem', { ...body, rewardId: '000000000000000000000000' }, vendCredential).set('Idempotency-Key', key).expect(404);
});

test('twin orders timestamps chronologically across different fractional precision', async () => {
  const second = new Date(Math.floor(Date.now() / 1000) * 1000 - 2000);
  const coarse = second.toISOString().replace('.000Z', 'Z');
  const fine = new Date(second.getTime() + 100).toISOString();
  await db.collection('machines').updateOne({ machineId: 'test-waste' }, { $unset: { observedAt: '' } });
  await controller('/events', { eventId: 'precision-coarse-first', observedAt: coarse, compartments: [{ category: 'pet', fillPercent: 10 }] }).expect(200);
  await controller('/events', { eventId: 'precision-fine-newer', observedAt: fine, compartments: [{ category: 'pet', fillPercent: 20 }] }).expect(200);
  await controller('/events', { eventId: 'precision-coarse-older', observedAt: coarse, compartments: [{ category: 'pet', fillPercent: 30 }] }).expect(200);
  const machine = (await admin.get('/api/admin/twin')).body.machines.find(m => m.machineId === 'test-waste');
  assert.equal(machine.observedAt, fine);
  assert.equal(machine.compartments[0].fillPercent, 20);
});
