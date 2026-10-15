import 'dotenv/config';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';

const config = {
  identityKey: process.env.IDENTITY_ENCRYPTION_KEY,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  production: process.env.NODE_ENV === 'production',
  aiEndpoint: process.env.AI_MODEL_ENDPOINT, aiKey: process.env.AI_MODEL_KEY,
};
if (config.production && !config.frontendUrl.startsWith('https://')) throw new Error('Production FRONTEND_URL must use HTTPS.');
const { db, client } = await connectDatabase(process.env.MONGODB_URI);
const app = createApp({ db, client, config });
const server = app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`EcoSync ready at ${config.frontendUrl}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await client.close(); process.exit(0); }));
