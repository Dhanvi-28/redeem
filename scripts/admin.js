import 'dotenv/config';
import { connectDatabase } from '../server/db.js';
const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('Usage: npm run admin -- registered-email@example.com');
const { db, client } = await connectDatabase(process.env.MONGODB_URI);
try {
  const result = await db.collection('users').updateOne({ email }, { $set: { role: 'admin' } });
  if (!result.matchedCount) throw new Error('Register this account through the application first.');
  console.log('Registered account promoted to admin. Refresh the application.');
} finally { await client.close(); }
