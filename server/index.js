import 'dotenv/config';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';

const config = {
  identityKey: process.env.IDENTITY_ENCRYPTION_KEY,
  frontendUrl: process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',
  trustProxy: process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : 0,
  production: process.env.NODE_ENV === 'production',
  aiEndpoint: process.env.AI_MODEL_ENDPOINT, aiKey: process.env.AI_MODEL_KEY,
  aiHealthEndpoint: process.env.AI_HEALTH_ENDPOINT,
};
if (!Number.isInteger(config.trustProxy) || config.trustProxy < 0) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
if (config.production && !config.frontendUrl.startsWith('https://')) throw new Error('Production FRONTEND_URL must use HTTPS.');
const { db, client } = await connectDatabase(process.env.MONGODB_URI);
const app = createApp({ db, client, config });
const host = process.env.HOST || (config.production ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(Number(process.env.PORT || 3000), host, () => console.log(`EcoSync ready at ${config.frontendUrl}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await client.close(); process.exit(0); }));
