import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { domain, ApiError, fail, oid, online } from './domain.js';
import { token, hash, identityCrypto } from './security.js';
import { transaction } from './db.js';

const text = z.string().trim().min(1).max(120);
const eventId = z.string().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const secret = z.string().min(32).max(256);
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.') });
const rewardSchema = z.object({ name: text, description: z.string().trim().max(1000).default(''), pointsPrice: z.number().int().min(1).max(1000000), stock: z.number().int().min(0).max(1000000), active: z.boolean(), machineId: z.string().max(120).nullable().default(null) }).strict();
const machineSchema = z.object({ machineId: eventId, name: text, type: z.enum(['waste_deposit', 'product_vending']), pairedMachineId: z.string().max(120).nullable().default(null), location: z.string().trim().max(200).nullable().default(null), enabled: z.boolean().default(true), categories: z.array(z.object({ category: text, pointsPerKg: z.number().int().min(1).max(100000), maxWeightGrams: z.number().int().min(1).max(50000), minConfidence: z.number().min(0).max(1) }).strict()).max(30).default([]) }).strict();
const parse = (schema, value) => schema.parse(value);
const cleanMachine = ({ credentialHash, ...m }) => ({ ...m, connected: online(m), integrationStatus: !m.enabled ? 'disabled' : online(m) ? 'connected' : m.lastSeenAt ? 'stale' : 'not_connected' });
const cleanDeposit = ({ fingerprint, sessionId, ...d }) => d;
const cleanRedemption = ({ fingerprint, key, ...r }) => r;

export function createApp({ db, client, config }) {
  const app = express(), c = name => db.collection(name), core = domain({ db, client });
  const crypto = identityCrypto(config.identityKey);
  const origin = new URL(config.frontendUrl).origin;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'script-src': ["'self'"], 'style-src': ["'self'"], 'connect-src': ["'self'"] } } }));
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/', maxAge: 7 * 86400000 };
  const limit = (windowMs, max) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Try again later.' } });
  app.use('/api', limit(60000, config.test ? 10000 : 300));
  app.use('/api/auth', limit(15 * 60000, config.test ? 10000 : 40));
  // Browser writes must carry this application's Origin. Controller APIs use bearer auth instead.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/machine/') && req.get('origin') !== origin) return next(new ApiError(403, 'Request origin is not allowed.'));
    next();
  });
  const auth = async (req, res, next) => {
    const value = req.cookies.ecosync_session;
    const session = value && await c('sessions').findOne({ tokenHash: hash(value), expiresAt: { $gt: new Date() } });
    if (!session) fail(401, 'Please log in.');
    const user = await c('users').findOne({ _id: session.userId }, { projection: { passwordHash: 0 } });
    if (!user) fail(401, 'Account unavailable.');
    req.user = user; next();
  };
  const admin = (req, res, next) => { if (req.user.role !== 'admin') fail(403, 'Administrator access required.'); next(); };
  const machineAuth = async (req, res, next) => {
    const credential = req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const machine = credential && await c('machines').findOne({ credentialHash: hash(credential), enabled: true });
    if (!machine) fail(401, 'Invalid controller credential.');
    req.machine = machine; next();
  };
  const publicUser = user => ({ _id: user._id, name: user.name, email: user.email, role: user.role });
  async function startSession(userId, res) {
    const value = token();
    await c('sessions').insertOne({ tokenHash: hash(value), userId, expiresAt: new Date(Date.now() + cookieOptions.maxAge) });
    res.cookie('ecosync_session', value, cookieOptions);
  }
  app.get('/api/health', async (req, res) => { await db.command({ ping: 1 }); res.json({ status: 'ok', aiConfigured: Boolean(config.aiEndpoint) }); });
  app.post('/api/auth/register', async (req, res) => {
    const data = parse(credentials.extend({ name: text }).strict(), req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = { _id: new ObjectId(), email: data.email, name: data.name, passwordHash, role: 'citizen', createdAt: new Date() };
    try {
      await transaction(client, async session => {
        const qr = token();
        await c('users').insertOne(user, { session });
        await c('qrIdentities').insertOne({ userId: user._id, tokenHash: hash(qr), encryptedToken: crypto.encrypt(qr), status: 'active', createdAt: new Date() }, { session });
        await c('wallets').insertOne({ userId: user._id, balance: 0, earned: 0, spent: 0 }, { session });
      });
    } catch (e) { if (e.code === 11000) fail(409, 'Account already exists.'); throw e; }
    await startSession(user._id, res); res.status(201).json(publicUser(user));
  });
  // Precomputed dummy hash prevents skipping the password work for unknown emails.
  const dummyPasswordHash = bcrypt.hashSync(token(), 12);
  app.post('/api/auth/login', async (req, res) => {
    const data = parse(credentials.strict(), req.body), user = await c('users').findOne({ email: data.email });
    const valid = await bcrypt.compare(data.password, user?.passwordHash || dummyPasswordHash);
    if (!user || !valid) fail(401, 'Email or password is incorrect.');
    if (req.cookies.ecosync_session) await c('sessions').deleteOne({ tokenHash: hash(req.cookies.ecosync_session) });
    await startSession(user._id, res); res.json(publicUser(user));
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.ecosync_session) await c('sessions').deleteOne({ tokenHash: hash(req.cookies.ecosync_session) });
    res.clearCookie('ecosync_session', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true });
  });
  app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));
  app.patch('/api/me', auth, async (req, res) => {
    const data = parse(z.object({ name: text }).strict(), req.body);
    await c('users').updateOne({ _id: req.user._id }, { $set: data }); res.json({ ...publicUser(req.user), ...data });
  });
  app.get('/api/me/qr', auth, async (req, res) => {
    const qr = await c('qrIdentities').findOne({ userId: req.user._id });
    if (!qr) fail(503, 'QR identity unavailable. Contact an operator.');
    res.set('Cache-Control', 'no-store');
    // The owner receives only a render, not the stored hash or encrypted representation.
    res.json({ image: await QRCode.toDataURL(crypto.decrypt(qr.encryptedToken), { width: 300, margin: 2 }), purpose: 'Identify your account at the waste-deposit machine. This QR does not log in to the website.' });
  });
  app.get('/api/dashboard', auth, async (req, res) => {
    const userId = req.user._id;
    const [wallet, deposits, redemptions, summary] = await Promise.all([
      c('wallets').findOne({ userId }, { projection: { _id: 0, userId: 0 } }),
      c('deposits').find({ userId }).sort({ createdAt: -1 }).limit(10).toArray(),
      c('redemptions').find({ userId }).sort({ createdAt: -1 }).limit(10).toArray(),
      c('deposits').aggregate([{ $match: { userId } }, { $group: { _id: null, count: { $sum: 1 }, weightGrams: { $sum: '$weightGrams' } } }]).next(),
    ]);
    res.json({ wallet, deposits: deposits.map(cleanDeposit), redemptions: redemptions.map(cleanRedemption), depositCount: summary?.count || 0, weightGrams: summary?.weightGrams || 0 });
  });
  const page = req => Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  app.get('/api/wallet', auth, async (req, res) => res.json({ wallet: await c('wallets').findOne({ userId: req.user._id }, { projection: { _id: 0, userId: 0 } }), transactions: await c('walletTransactions').find({ userId: req.user._id }, { projection: { key: 0, userId: 0 } }).sort({ createdAt: -1 }).skip(page(req)).limit(50).toArray() }));
  app.get('/api/deposits', auth, async (req, res) => res.json((await c('deposits').find({ userId: req.user._id }).sort({ createdAt: -1 }).skip(page(req)).limit(50).toArray()).map(cleanDeposit)));
  app.get('/api/redemptions', auth, async (req, res) => res.json((await c('redemptions').find({ userId: req.user._id }).sort({ createdAt: -1 }).skip(page(req)).limit(50).toArray()).map(cleanRedemption)));
  app.get('/api/rewards', auth, async (req, res) => res.json(await c('rewards').find({ active: true }).sort({ name: 1 }).limit(200).toArray()));
  app.post('/api/rewards/redeem', limit(60000, config.test ? 10000 : 20), auth, async (req, res) => {
    const input = parse(z.object({ rewardId: text }).strict(), req.body), key = parse(eventId, req.get('idempotency-key'));
    res.json(cleanRedemption(await core.redeem(req.user._id, input, key)));
  });
  app.get('/api/redemptions/by-key/:key', auth, async (req, res) => {
    const key = parse(eventId, req.params.key);
    const record = await c('redemptions').findOne({ userId: req.user._id, key, machineId: null });
    if (!record) fail(404, 'No committed website redemption found for this key.');
    res.json(cleanRedemption(record));
  });
  app.post('/api/scan', limit(60000, 10), auth, async (req, res) => {
    if (!config.aiEndpoint) fail(503, 'AI classification is not configured.');
    const input = parse(z.object({ image: z.string().max(7000000), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).strict(), req.body);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) fail(422, 'Invalid image encoding.');
    const bytes = Buffer.from(input.image, 'base64');
    if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12) fail(422, 'Image must be between 12 bytes and 5 MB.');
    const isImage = input.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : input.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!isImage) fail(422, 'Image content does not match its type.');
    let response;
    try { response = await fetch(config.aiEndpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(config.aiKey ? { authorization: `Bearer ${config.aiKey}` } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) }); }
    catch { fail(502, 'Classifier unavailable. Try again later.'); }
    if (!response.ok) fail(502, 'Classifier request failed.');
    let result;
    try { result = parse(z.object({ category: text, confidence: z.number().min(0).max(1).optional(), guidance: z.array(z.string().max(1000)).max(20).optional(), modelVersion: text }), await response.json()); }
    catch { fail(502, 'Classifier returned an invalid result.'); }
    res.json({ ...result, pointsAwarded: 0 });
  });

  app.use('/api/machine', machineAuth);
  app.post('/api/machine/identify', limit(60000, config.test ? 10000 : 30), async (req, res) => {
    const input = parse(z.union([z.object({ qrToken: secret }).strict(), z.object({ rfidToken: secret }).strict()]), req.body);
    res.json(await core.identify(req.machine, input));
  });
  app.post('/api/machine/deposits', async (req, res) => {
    const input = parse(z.object({ eventId, sessionId: secret, category: text, weightGrams: z.number().int().min(1).max(50000), stable: z.literal(true), sorted: z.literal(true), confidence: z.number().min(0).max(1), modelVersion: text, classificationId: text, measuredAt: z.string().datetime() }).strict(), req.body);
    res.json(cleanDeposit(await core.deposit(req.machine, input)));
  });
  app.post('/api/machine/deposits/:id/choice', async (req, res) => {
    const { choice } = parse(z.object({ choice: z.enum(['save', 'redeem']) }).strict(), req.body);
    res.json(await core.choose(req.machine, req.params.id, choice));
  });
  app.post('/api/machine/redeem', async (req, res) => {
    const input = parse(z.object({ sessionId: secret, rewardId: text }).strict(), req.body), key = parse(eventId, req.get('idempotency-key'));
    // TTL cleanup must not make a committed command impossible to recover.
    const committed = await c('redemptions').findOne({ machineId: req.machine.machineId, key, fingerprint: hash(JSON.stringify({ rewardId: input.rewardId, sessionId: input.sessionId })) });
    if (committed) return res.json(cleanRedemption(committed));
    const rs = await c('redemptionSessions').findOne({ _id: input.sessionId, machineId: req.machine.machineId });
    if (!rs) fail(404, 'Redemption session not found.');
    res.json(cleanRedemption(await core.redeem(rs.userId, input, key, req.machine)));
  });
  app.get('/api/machine/commands', async (req, res) => {
    if (req.machine.type !== 'product_vending') fail(403, 'Product controller required.');
    const [activations, commands, rewards] = await Promise.all([
      c('redemptionSessions').find({ machineId: req.machine.machineId, consumed: false, expiresAt: { $gt: new Date() } }, { projection: { userId: 0 } }).limit(100).toArray(),
      c('redemptions').find({ machineId: req.machine.machineId, status: 'awaiting_dispense' }, { projection: { _id: 1, rewardId: 1, rewardName: 1 } }).limit(100).toArray(),
      c('rewards').find({ machineId: req.machine.machineId, active: true, stock: { $gt: 0 } }).limit(200).toArray(),
    ]);
    res.json({ activations, commands: commands.map(x => ({ commandId: x._id, rewardId: x.rewardId, rewardName: x.rewardName })), rewards });
  });
  app.post('/api/machine/redemptions/:id/outcome', async (req, res) => {
    const input = parse(z.object({ eventId, status: z.enum(['dispensed', 'failed']) }).strict(), req.body);
    res.json(cleanRedemption(await core.outcome(req.params.id, input.status, { machineId: req.machine.machineId }, input.eventId)));
  });
  app.post('/api/machine/events', async (req, res) => {
    const input = parse(z.object({ eventId, observedAt: z.string().datetime(), compartments: z.array(z.object({ category: text, fillPercent: z.number().min(0).max(100) }).strict()).max(30).optional(), alert: z.string().max(300).nullable().optional() }).strict(), req.body);
    const fingerprint = hash(JSON.stringify(input));
    await transaction(client, async session => {
      const prior = await c('machineEvents').findOne({ machineId: req.machine.machineId, eventId: input.eventId }, { session });
      if (prior) { if (prior.fingerprint !== fingerprint) fail(409, 'Event ID already used.'); return; }
      if (Math.abs(Date.now() - Date.parse(input.observedAt)) > 300000) fail(422, 'Telemetry timestamp is stale.');
      await c('machineEvents').insertOne({ ...input, fingerprint, machineId: req.machine.machineId, kind: 'telemetry', createdAt: new Date() }, { session });
      // ISO timestamps allow different fractional precision; string order is not time order.
      await c('machines').updateOne({ _id: req.machine._id, $expr: { $lt: [{ $convert: { input: '$observedAt', to: 'date', onError: new Date(0), onNull: new Date(0) } }, new Date(input.observedAt)] } }, { $set: { lastSeenAt: new Date(), observedAt: input.observedAt, ...(input.compartments ? { compartments: input.compartments, compartmentsObservedAt: input.observedAt } : {}), ...(input.alert !== undefined ? { alert: input.alert, alertObservedAt: input.observedAt } : {}) } }, { session });
    });
    res.json({ ok: true });
  });

  app.use('/api/admin', auth, admin);
  app.get('/api/admin/overview', async (req, res) => {
    const [users, deposits, totals, spent, redemptions] = await Promise.all([
      c('users').countDocuments(), c('deposits').countDocuments(),
      c('deposits').aggregate([{ $group: { _id: null, weightGrams: { $sum: '$weightGrams' }, points: { $sum: '$points' } } }]).next(),
      c('wallets').aggregate([{ $group: { _id: null, points: { $sum: '$spent' } } }]).next(),
      c('redemptions').countDocuments({ status: { $in: ['awaiting_dispense', 'pending_fulfillment'] } }),
    ]);
    res.json({ users, deposits, weightGrams: totals?.weightGrams || 0, pointsIssued: totals?.points || 0, pointsSpent: spent?.points || 0, pendingRedemptions: redemptions });
  });
  app.get('/api/admin/twin', async (req, res) => {
    const [machines, events, inventory, pending] = await Promise.all([
      c('machines').find().limit(200).toArray(),
      c('machineEvents').find({}, { projection: { fingerprint: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
      c('rewards').find({ machineId: { $ne: null } }, { projection: { name: 1, machineId: 1, stock: 1, active: 1, pointsPrice: 1 } }).limit(200).toArray(),
      c('redemptions').aggregate([{ $match: { machineId: { $ne: null }, status: 'awaiting_dispense' } }, { $group: { _id: '$machineId', count: { $sum: 1 } } }]).toArray(),
    ]);
    res.json({ machines: machines.map(m => ({ ...cleanMachine(m), inventory: inventory.filter(r => r.machineId === m.machineId), pendingDispenses: pending.find(r => r._id === m.machineId)?.count || 0 })), events, observedAt: new Date() });
  });
  for (const name of ['users', 'rewards', 'deposits', 'redemptions']) {
    app.get(`/api/admin/${name}`, async (req, res) => {
      const rows = await c(name).find({}, { projection: { passwordHash: 0, fingerprint: 0, sessionId: 0, key: 0 } }).sort({ createdAt: -1, _id: -1 }).skip(page(req)).limit(100).toArray(); res.json(rows);
    });
  }
  app.post('/api/admin/machines', async (req, res) => {
    const input = parse(machineSchema, req.body), credential = token();
    if (new Set(input.categories.map(x => x.category)).size !== input.categories.length) fail(422, 'Duplicate category rules.');
    await c('machines').insertOne({ ...input, credentialHash: hash(credential), createdAt: new Date() });
    res.status(201).json({ machineId: input.machineId, credential });
  });
  app.patch('/api/admin/machines/:id', async (req, res) => {
    // Creation defaults must not reset omitted fields during a partial edit.
    const input = parse(machineSchema.omit({ machineId: true, type: true }).extend({ pairedMachineId: machineSchema.shape.pairedMachineId.removeDefault(), location: machineSchema.shape.location.removeDefault(), enabled: machineSchema.shape.enabled.removeDefault(), categories: machineSchema.shape.categories.removeDefault() }).partial(), req.body);
    if (input.categories && new Set(input.categories.map(x => x.category)).size !== input.categories.length) fail(422, 'Duplicate category rules.');
    const result = await c('machines').updateOne({ machineId: req.params.id }, { $set: input });
    if (!result.matchedCount) fail(404, 'Machine not found.'); res.json({ ok: true });
  });
  app.post('/api/admin/machines/:id/rotate-credential', async (req, res) => {
    const credential = token(), result = await c('machines').updateOne({ machineId: req.params.id }, { $set: { credentialHash: hash(credential) } });
    if (!result.matchedCount) fail(404, 'Machine not found.'); res.json({ credential });
  });
  app.post('/api/admin/rewards', async (req, res) => {
    const input = parse(rewardSchema, req.body);
    if (input.machineId && !await c('machines').findOne({ machineId: input.machineId, type: 'product_vending', enabled: true })) fail(422, 'Configure an enabled product unit first.');
    const result = await c('rewards').insertOne({ ...input, version: 0, createdAt: new Date() }); res.status(201).json({ _id: result.insertedId });
  });
  app.patch('/api/admin/rewards/:id', async (req, res) => {
    const { version, ...input } = parse(rewardSchema.extend({ version: z.number().int().min(0) }), req.body);
    if (input.machineId && !await c('machines').findOne({ machineId: input.machineId, type: 'product_vending', enabled: true })) fail(422, 'Invalid product unit.');
    await transaction(client, async session => {
      const opts = { session }, rewardId = oid(req.params.id);
      const current = await c('rewards').findOne({ _id: rewardId, version }, opts);
      if (!current) fail(409, 'Inventory changed while editing. Refresh the catalogue and reconcile current stock.');
      if (current.machineId !== input.machineId && await c('redemptions').findOne({ rewardId, status: { $in: ['awaiting_dispense', 'pending_fulfillment'] } }, opts)) fail(409, 'Finalize pending orders before moving this product to another fulfillment location.');
      const result = await c('rewards').updateOne({ _id: rewardId, version }, { $set: { ...input, inventoryUpdatedAt: new Date(), inventoryUpdatedBy: req.user._id }, $inc: { version: 1 } }, opts);
      if (!result.matchedCount) fail(409, 'Inventory changed while editing. Refresh the catalogue and reconcile current stock.');
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/redemptions/:id/outcome', async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['fulfilled', 'failed']) }).strict(), req.body);
    res.json(cleanRedemption(await core.outcome(req.params.id, status, { adminId: req.user._id })));
  });
  app.post('/api/admin/rfid', async (req, res) => {
    const input = parse(z.object({ userId: text, rfidToken: secret }).strict(), req.body), userId = oid(input.userId);
    if (!await c('users').findOne({ _id: userId })) fail(404, 'User not found.');
    const result = await c('rfidCards').insertOne({ userId, cardHash: hash(input.rfidToken), status: 'active', linkedAt: new Date() });
    res.status(201).json({ _id: result.insertedId });
  });
  app.delete('/api/admin/rfid/:id', async (req, res) => { await c('rfidCards').updateOne({ _id: oid(req.params.id) }, { $set: { status: 'revoked' } }); res.json({ ok: true }); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  // The preserved demo has decorative inline styles; all executable scripts remain external.
  app.get('/simulation.html', (req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'; base-uri 'self'"); next();
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { index: 'index.html', setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError) return res.status(422).json({ error: err.issues.map(x => `${x.path.join('.') || 'request'}: ${x.message}`).join('; ') });
    if (err.code === 11000) return res.status(409).json({ error: 'A record with this unique identifier already exists.' });
    const status = err.status || 500;
    if (status === 500) console.error('Request failed:', err.name, err.code || '');
    res.status(status).json({ error: status < 500 || err instanceof ApiError ? err.message : 'Service unavailable. Please try again.' });
  });
  return app;
}
