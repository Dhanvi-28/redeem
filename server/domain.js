import { ObjectId } from 'mongodb';
import { transaction } from './db.js';
import { hash, token } from './security.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new ApiError(status, message); };
export const oid = value => {
  if (!ObjectId.isValid(value) || !/^[a-f0-9]{24}$/i.test(String(value))) fail(400, 'Invalid record identifier.');
  return new ObjectId(value);
};
export const online = machine => Boolean(machine?.enabled && machine.lastSeenAt && Date.now() - new Date(machine.lastSeenAt).getTime() >= 0 && Date.now() - new Date(machine.lastSeenAt).getTime() < 90000);
const same = (a, b) => String(a) === String(b);
function replay(record, fingerprint) {
  if (record.fingerprint !== fingerprint) fail(409, 'Idempotency key already used for a different request.');
  return record;
}

export function domain({ db, client }) {
  const c = name => db.collection(name);
  async function identify(machine, input) {
    if (machine.type !== 'waste_deposit') fail(403, 'Only waste controllers can identify citizens.');
    const identity = input.qrToken
      ? await c('qrIdentities').findOne({ tokenHash: hash(input.qrToken), status: 'active' })
      : await c('rfidCards').findOne({ cardHash: hash(input.rfidToken), status: 'active' });
    if (!identity) fail(404, 'Identity unavailable.');
    const record = { _id: token(), userId: identity.userId, machineId: machine.machineId, expiresAt: new Date(Date.now() + 5 * 60000), consumed: false };
    await c('depositSessions').insertOne(record);
    return { sessionId: record._id, expiresAt: record.expiresAt };
  }

  async function deposit(machine, input) {
    if (machine.type !== 'waste_deposit') fail(403, 'Waste controller required.');
    const fingerprint = hash(JSON.stringify(input));
    return transaction(client, async session => {
      const opts = { session }, filter = { machineId: machine.machineId, eventId: input.eventId };
      const existing = await c('deposits').findOne(filter, opts);
      if (existing) return replay(existing, fingerprint);
      if (Math.abs(Date.now() - Date.parse(input.measuredAt)) > 300000) fail(422, 'Measurement must be within five minutes.');
      const ds = await c('depositSessions').findOne({ _id: input.sessionId, machineId: machine.machineId, consumed: false, expiresAt: { $gt: new Date() } }, opts);
      if (!ds) fail(409, 'Deposit session expired or already consumed. Scan the identity again.');
      const rule = machine.categories.find(x => x.category === input.category);
      if (!rule || input.confidence < rule.minConfidence || input.weightGrams > rule.maxWeightGrams) fail(422, 'Deposit does not meet configured acceptance rules.');
      const points = Math.floor(input.weightGrams * rule.pointsPerKg / 1000);
      if (points < 1) fail(422, 'Accepted weight is too small to earn a point.');
      const record = { ...input, _id: new ObjectId(), userId: ds.userId, machineId: machine.machineId, points, fingerprint, validation: 'verified', choice: null, createdAt: new Date() };
      await c('depositSessions').updateOne({ _id: ds._id }, { $set: { consumed: true } }, opts);
      await c('deposits').insertOne(record, opts);
      await c('wallets').updateOne({ userId: ds.userId }, { $inc: { balance: points, earned: points } }, opts);
      await c('walletTransactions').insertOne({ userId: ds.userId, type: 'deposit', delta: points, depositId: record._id, key: `deposit:${record._id}`, createdAt: new Date() }, opts);
      await c('machineEvents').insertOne({ ...filter, kind: 'deposit', depositId: record._id, createdAt: new Date() }, opts);
      await c('machines').updateOne({ _id: machine._id }, { $set: { lastSeenAt: new Date(), lastDeposit: { category: input.category, weightGrams: input.weightGrams, points, measuredAt: input.measuredAt } } }, opts);
      return record;
    });
  }

  async function choose(machine, depositId, choice) {
    return transaction(client, async session => {
      const opts = { session }, dep = await c('deposits').findOne({ _id: oid(depositId), machineId: machine.machineId }, opts);
      if (!dep) fail(404, 'Deposit not found.');
      if (dep.choice && dep.choice !== choice) fail(409, 'Deposit choice has already been recorded.');
      if (!dep.choice && Date.now() - dep.createdAt.getTime() > 10 * 60000) fail(409, 'Machine choice window expired. Points remain saved in the wallet.');
      if (choice === 'save') {
        await c('deposits').updateOne({ _id: dep._id }, { $set: { choice } }, opts);
        return { choice, message: 'Points saved in wallet.' };
      }
      const previous = await c('redemptionSessions').findOne({ depositId: dep._id }, opts);
      if (previous) return { choice, sessionId: previous._id, expiresAt: previous.expiresAt };
      const unit = await c('machines').findOne({ machineId: machine.pairedMachineId, type: 'product_vending', enabled: true }, opts);
      if (!online(unit)) fail(503, 'Attached vending controller is not connected. Points remain in wallet.');
      const rs = { _id: token(), userId: dep.userId, depositId: dep._id, machineId: unit.machineId, expiresAt: new Date(Date.now() + 5 * 60000), consumed: false };
      await c('redemptionSessions').insertOne(rs, opts);
      await c('deposits').updateOne({ _id: dep._id }, { $set: { choice } }, opts);
      return { choice, sessionId: rs._id, expiresAt: rs.expiresAt };
    });
  }

  async function redeem(userId, input, key, machine = null) {
    const fingerprint = hash(JSON.stringify({ rewardId: input.rewardId, sessionId: input.sessionId || null }));
    return transaction(client, async session => {
      const opts = { session }, existing = await c('redemptions').findOne({ userId, key }, opts);
      if (existing) return replay(existing, fingerprint);
      let rs = null;
      if (machine) {
        if (machine.type !== 'product_vending') fail(403, 'Product controller required.');
        rs = await c('redemptionSessions').findOne({ _id: input.sessionId, userId, machineId: machine.machineId, consumed: false, expiresAt: { $gt: new Date() } }, opts);
        if (!rs) fail(409, 'Redemption session expired or already used.');
      }
      const reward = await c('rewards').findOne({ _id: oid(input.rewardId), active: true }, opts);
      if (!reward || reward.stock <= 0) fail(409, 'Reward unavailable or out of stock.');
      if (reward.machineId && (!machine || reward.machineId !== machine.machineId)) fail(409, 'This reward requires a visit to its vending station.');
      if (machine && reward.machineId !== machine.machineId) fail(409, 'Reward is not stocked in this unit.');
      const wallet = await c('wallets').updateOne({ userId, balance: { $gte: reward.pointsPrice } }, { $inc: { balance: -reward.pointsPrice, spent: reward.pointsPrice } }, opts);
      if (!wallet.modifiedCount) fail(409, 'Insufficient points.');
      const stock = await c('rewards').updateOne({ _id: reward._id, active: true, stock: { $gt: 0 } }, { $inc: { stock: -1, version: 1 } }, opts);
      if (!stock.modifiedCount) fail(409, 'Reward out of stock.');
      const record = { _id: new ObjectId(), userId, key, fingerprint, rewardId: reward._id, rewardName: reward.name, pointsSpent: reward.pointsPrice, machineId: machine?.machineId || null, depositId: rs?.depositId || null, status: machine ? 'awaiting_dispense' : 'pending_fulfillment', createdAt: new Date() };
      await c('redemptions').insertOne(record, opts);
      await c('walletTransactions').insertOne({ userId, type: 'redemption', delta: -reward.pointsPrice, redemptionId: record._id, key: `redeem:${record._id}`, createdAt: new Date() }, opts);
      if (rs) await c('redemptionSessions').updateOne({ _id: rs._id }, { $set: { consumed: true } }, opts);
      return record;
    });
  }

  async function outcome(id, status, source, eventId) {
    return transaction(client, async session => {
      const opts = { session }, red = await c('redemptions').findOne({ _id: oid(id) }, opts);
      if (!red || (source.machineId && red.machineId !== source.machineId)) fail(404, 'Redemption not found.');
      if (source.machineId && red.status === 'pending_fulfillment') fail(409, 'Website order cannot be dispensed by a controller.');
      if (!source.machineId && red.machineId) fail(409, 'Machine orders require an authenticated controller outcome; reconcile unknown physical outcomes before retrying.');
      const target = status === 'failed' ? 'refunded' : source.machineId ? 'dispensed' : 'fulfilled';
      // Validate the event binding even for an already-finalized order. Otherwise a
      // reused event could appear successful while belonging to another command.
      if (source.machineId) {
        const prior = await c('machineEvents').findOne({ machineId: source.machineId, eventId }, opts);
        if (prior && (!same(prior.redemptionId, red._id) || prior.kind !== target)) fail(409, 'Event ID already used for a different outcome.');
        if (!prior) await c('machineEvents').insertOne({ machineId: source.machineId, eventId, redemptionId: red._id, kind: target, createdAt: new Date() }, opts);
      }
      if (['dispensed', 'fulfilled', 'refunded'].includes(red.status)) {
        if (red.status !== target) fail(409, 'Conflicting outcome; redemption already finalized.');
        return red;
      }
      if (status === 'failed') {
        await c('wallets').updateOne({ userId: red.userId }, { $inc: { balance: red.pointsSpent, spent: -red.pointsSpent } }, opts);
        await c('walletTransactions').insertOne({ userId: red.userId, type: 'refund', delta: red.pointsSpent, redemptionId: red._id, key: `refund:${red._id}`, createdAt: new Date() }, opts);
        // Failure means controller confirms no physical delivery; unknown outcomes stay pending.
        await c('rewards').updateOne({ _id: red.rewardId }, { $inc: { stock: 1, version: 1 } }, opts);
      }
      await c('redemptions').updateOne({ _id: red._id }, { $set: { status: target, completedAt: new Date(), outcomeSource: source.machineId || String(source.adminId) } }, opts);
      return { ...red, status: target };
    });
  }
  return { identify, deposit, choose, redeem, outcome };
}
