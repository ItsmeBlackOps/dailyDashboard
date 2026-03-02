import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

async function normalizeUserEmailsToLowercase() {
  try {
    await database.connect();
    const collection = database.getCollection('users');
    const cursor = collection.find({}, { projection: { _id: 1, email: 1 } });

    let scanned = 0;
    let updated = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc?.email || typeof doc.email !== 'string') continue;

      scanned += 1;
      const normalized = doc.email.trim().toLowerCase();
      if (doc.email !== normalized) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { email: normalized, updatedAt: new Date() } }
        );
        updated += 1;
      }
    }

    logger.info('Normalized user emails to lowercase', { scanned, updated });
    console.log(`Normalization complete. scanned=${scanned} updated=${updated}`);
  } catch (error) {
    logger.error('Failed to normalize user emails', { error: error.message });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

normalizeUserEmailsToLowercase();

