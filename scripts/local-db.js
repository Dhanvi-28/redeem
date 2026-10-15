import { resolve } from 'node:path';
import { startMongo } from './mongo-process.js';
const { child, uri } = await startMongo({ directory: resolve('.local/mongo'), port: 27018, replicaSet: 'ecosync' });
console.log(`Local development replica set ready: ${uri}\nKeep this terminal open. Ctrl+C stops MongoDB. Local data persists in .local/mongo.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', code => process.exit(code || 0));
