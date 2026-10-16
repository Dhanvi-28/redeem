// Explicit starter product configuration, never a claim of physical inventory.
export const starterRewards = [
  { catalogueKey: 'instant-noodles', name: 'Instant noodles', description: 'A packaged instant noodle cup or pack. Brand and pack size are confirmed by the operator before fulfillment.', pointsPrice: 80 },
  { catalogueKey: 'snack-pack', name: 'Snack pack', description: 'A sealed savory snack pack. Available varieties are confirmed at collection.', pointsPrice: 60 },
  { catalogueKey: 'biscuit-pack', name: 'Biscuit pack', description: 'A sealed biscuit pack for a quick snack. Check the label for ingredients and allergens.', pointsPrice: 50 },
  { catalogueKey: 'juice-box', name: 'Juice box', description: 'A sealed single-serving juice carton. Flavor and pack size depend on operator-supplied stock.', pointsPrice: 70 },
  { catalogueKey: 'pencil-set', name: 'Pencil set', description: 'A small set of writing pencils for everyday study and work.', pointsPrice: 40 },
  { catalogueKey: 'notebook', name: 'Notebook', description: 'A writing notebook for notes, sketches and study.', pointsPrice: 100 },
  { catalogueKey: 'reusable-tote', name: 'Reusable tote bag', description: 'A reusable shopping bag to help reduce single-use carry bags.', pointsPrice: 180 },
  { catalogueKey: 'reusable-bottle', name: 'Reusable water bottle', description: 'A refillable drinking bottle. Material and capacity are confirmed before collection.', pointsPrice: 250 },
];

export async function configureCatalogue(db) {
  const rewards = db.collection('rewards');
  await rewards.createIndex({ catalogueKey: 1 }, { unique: true, sparse: true });
  let added = 0;
  for (const product of starterRewards) {
    // Preserve products already created by an operator, including their prices/stock.
    if (await rewards.findOne({ name: product.name })) continue;
    const result = await rewards.updateOne({ catalogueKey: product.catalogueKey }, { $setOnInsert: {
      ...product, stock: 0, active: true, machineId: null, version: 0, createdAt: new Date(),
    } }, { upsert: true });
    added += result.upsertedCount;
  }
  return added;
}
