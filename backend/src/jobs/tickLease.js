// Single-owner tick lease over Mongo. Both blue/green backends run the same
// schedulers; a short lease in `schedulerLocks` makes exactly one process the
// owner per tick window. On owner death the lease expires and the other color
// takes over. Same pattern as firefliesBotScheduler's inline lease.
export async function acquireTickLease(db, leaseId, owner, leaseMs) {
  const now = new Date();
  try {
    const doc = await db.collection('schedulerLocks').findOneAndUpdate(
      {
        _id: leaseId,
        $or: [{ owner }, { expiresAt: { $lt: now } }],
      },
      { $set: { owner, expiresAt: new Date(now.getTime() + leaseMs) } },
      { upsert: true, returnDocument: 'after' }
    );
    // driver v6 returns the doc (or null); v5 wrapped it in { value }
    return Boolean(doc && (doc.value !== undefined ? doc.value : doc));
  } catch (err) {
    if (err && err.code === 11000) return false; // upsert raced an unexpired holder
    throw err;
  }
}
