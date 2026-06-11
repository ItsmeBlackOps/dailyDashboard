import { applyIndexDeclarations, INDEX_DECLARATIONS } from '../ensurePerfIndexes.js';

const makeFakeDb = (failOn) => {
  const attempts = [];
  return {
    attempts,
    collection(coll) {
      return {
        async createIndex(keys, opts = {}) {
          attempts.push({ coll, keys, opts });
          if (failOn && failOn(coll, keys)) {
            const err = new Error('Index already exists with a different name: Candidate Name');
            err.code = 85;
            err.codeName = 'IndexOptionsConflict';
            throw err;
          }
          return Object.keys(keys).map((k) => `${k}_${keys[k]}`).join('_');
        }
      };
    }
  };
};

describe('applyIndexDeclarations', () => {
  it('applies every declaration when none fail', async () => {
    const db = makeFakeDb(null);
    const { created, failed } = await applyIndexDeclarations(db);

    expect(created).toBe(INDEX_DECLARATIONS.length);
    expect(failed).toBe(0);
    expect(db.attempts.length).toBe(INDEX_DECLARATIONS.length);
  });

  it('continues past an IndexOptionsConflict instead of aborting the rest', async () => {
    // Reproduces the prod incident: taskBody has a legacy hand-named index on
    // { 'Candidate Name': 1 }, so createIndex throws code 85 — every
    // declaration after it must still be attempted.
    const db = makeFakeDb(
      (coll, keys) => coll === 'taskBody' && Object.keys(keys).join(',') === 'Candidate Name'
    );

    const { created, failed } = await applyIndexDeclarations(db);

    expect(failed).toBe(1);
    expect(created).toBe(INDEX_DECLARATIONS.length - 1);
    // Specifically: the declarations that were silently skipped in prod
    // (interview-date indexes + perfMetrics TTL) must have been attempted.
    const attemptedKeys = db.attempts.map((a) => `${a.coll}:${Object.keys(a.keys).join(',')}`);
    expect(attemptedKeys).toContain('taskBody:interviewStartAt');
    expect(attemptedKeys).toContain('taskBody:interviewStartAt,_id');
    expect(attemptedKeys).toContain('perfMetrics:createdAt');
  });

  it('isolates failures per declaration even when several conflict', async () => {
    const db = makeFakeDb((coll) => coll === 'candidateDetails');
    const candidateCount = INDEX_DECLARATIONS.filter((d) => d.coll === 'candidateDetails').length;

    const { created, failed } = await applyIndexDeclarations(db);

    expect(failed).toBe(candidateCount);
    expect(created).toBe(INDEX_DECLARATIONS.length - candidateCount);
    expect(db.attempts.length).toBe(INDEX_DECLARATIONS.length);
  });
});
