import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureCatalogue, starterRewards } from '../server/catalogue.js';

test('explicit catalogue configuration preserves existing inventory and is repeatable', async () => {
  const existing = { ...starterRewards[0], stock: 3, pointsPrice: 99, active: true };
  const rows = [existing];
  const db = { collection: () => ({
    async createIndex() {},
    async findOne(query) { return rows.find(row => row.name === query.name); },
    async updateOne(query, update) {
      if (rows.some(row => row.catalogueKey === query.catalogueKey)) return { upsertedCount: 0 };
      rows.push(update.$setOnInsert); return { upsertedCount: 1 };
    },
  }) };
  assert.equal(await configureCatalogue(db), 7);
  assert.equal(await configureCatalogue(db), 0);
  assert.equal(rows.length, 8);
  assert.equal(existing.stock, 3); assert.equal(existing.pointsPrice, 99);
  assert.ok(rows.slice(1).every(row => row.stock === 0 && row.active && row.machineId === null && row.version === 0));
});
