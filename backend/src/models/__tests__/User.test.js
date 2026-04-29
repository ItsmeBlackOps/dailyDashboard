import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const { UserModel } = await import('../User.js');

function makeModel() {
  const model = new UserModel();
  const insertOne = jest.fn().mockResolvedValue({ insertedId: 'u-1' });
  model.collection = { insertOne };
  // Disable cache write side-effect
  model.setCacheEntryFromDocument = jest.fn();
  return { model, insertOne };
}

describe('UserModel.createUser — defaults', () => {
  it('defaults active=true when active is not provided', async () => {
    const { model, insertOne } = makeModel();
    await model.createUser({ email: 'a@x.com', password: 'pw1234' });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ active: true })
    );
  });

  it('respects explicit active=false', async () => {
    const { model, insertOne } = makeModel();
    await model.createUser({ email: 'b@x.com', password: 'pw1234', active: false });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ active: false })
    );
  });

  it('defaults adminHash to the user passwordHash when not provided', async () => {
    const { model, insertOne } = makeModel();
    await model.createUser({ email: 'c@x.com', password: 'pw1234' });
    const arg = insertOne.mock.calls[0][0];
    expect(arg.adminHash).toBeTruthy();
    expect(arg.adminHash).toBe(arg.passwordHash);
  });

  it('honours an explicit adminHash (parent admin hash)', async () => {
    const { model, insertOne } = makeModel();
    const parentHash = 'a'.repeat(64);
    await model.createUser({ email: 'd@x.com', password: 'pw1234', adminHash: parentHash });
    const arg = insertOne.mock.calls[0][0];
    expect(arg.adminHash).toBe(parentHash);
    expect(arg.adminHash).not.toBe(arg.passwordHash);
  });

  it('falls back to passwordHash when adminHash is null/empty', async () => {
    const { model, insertOne } = makeModel();
    await model.createUser({ email: 'e@x.com', password: 'pw1234', adminHash: null });
    const arg = insertOne.mock.calls[0][0];
    expect(arg.adminHash).toBe(arg.passwordHash);
  });
});
