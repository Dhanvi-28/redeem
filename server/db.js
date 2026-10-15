import { MongoClient } from 'mongodb';

export async function connectDatabase(uri) {
  if (!uri) throw new Error('MONGODB_URI is required. See .env.example.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const hello = await client.db('admin').command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await client.close();
    throw new Error('MongoDB must be a replica set or Atlas cluster: wallet operations require transactions.');
  }
  const db = client.db();
  const indexes = {
    users: [[{ email: 1 }, { unique: true }]],
    qrIdentities: [[{ userId: 1 }, { unique: true }], [{ tokenHash: 1 }, { unique: true }]],
    rfidCards: [[{ cardHash: 1 }, { unique: true }]],
    wallets: [[{ userId: 1 }, { unique: true }]],
    walletTransactions: [[{ key: 1 }, { unique: true }], [{ userId: 1, createdAt: -1 }, {}]],
    deposits: [[{ machineId: 1, eventId: 1 }, { unique: true }], [{ userId: 1, createdAt: -1 }, {}]],
    redemptions: [[{ userId: 1, key: 1 }, { unique: true }]],
    machineEvents: [[{ machineId: 1, eventId: 1 }, { unique: true }]],
    machines: [[{ machineId: 1 }, { unique: true }]],
    sessions: [[{ tokenHash: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
    depositSessions: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
    redemptionSessions: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
  };
  for (const [name, specs] of Object.entries(indexes)) {
    await db.createCollection(name).catch(e => { if (e.code !== 48) throw e; });
    for (const [keys, options] of specs) await db.collection(name).createIndex(keys, options);
  }
  await db.createCollection('rewards').catch(e => { if (e.code !== 48) throw e; });
  return { db, client };
}

export async function transaction(client, operation) {
  // Unique-key races can follow a transaction retry; rerun to return the committed result.
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = client.startSession();
    try {
      return await session.withTransaction(() => operation(session), {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
      });
    } catch (e) {
      if (e.code !== 11000 || attempt === 2) throw e;
    } finally { await session.endSession(); }
  }
}
