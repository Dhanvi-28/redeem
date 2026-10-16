import 'dotenv/config';
import { connectDatabase } from '../server/db.js';
import { configureCatalogue } from '../server/catalogue.js';

const { db, client } = await connectDatabase(process.env.MONGODB_URI);
try {
  const added = await configureCatalogue(db);
  console.log(`Configured ${added} new rewards. Existing products were preserved. New products have zero stock until an operator supplies inventory.`);
} finally { await client.close(); }
