import { describe, beforeEach, afterAll, expect, it, jest } from '@jest/globals';
import { refreshTokenModel } from '../src/models/RefreshToken.js';

const originalCollection = refreshTokenModel.collection;

const makeFutureDate = (minutes = 5) => new Date(Date.now() + minutes * 60 * 1000);
const makePastDate = (minutes = 5) => new Date(Date.now() - minutes * 60 * 1000);

describe('RefreshTokenModel', () => {
  const mockCollection = {
    findOne: jest.fn(),
    insertOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(() => {
    refreshTokenModel.collection = mockCollection;
    refreshTokenModel.cache.clear();

    mockCollection.findOne.mockReset();
    mockCollection.insertOne.mockReset();
    mockCollection.deleteOne.mockReset();
    mockCollection.deleteMany.mockReset();
    mockCollection.find.mockReset();
  });

  afterAll(() => {
    refreshTokenModel.collection = originalCollection;
  });

  it('returns token data from cache without hitting the database twice', async () => {
    const token = 'cached-token';
    const record = {
      token,
      email: 'user@example.com',
      expiresAt: makeFutureDate(),
      createdAt: new Date(),
    };

    mockCollection.findOne.mockResolvedValue(record);

    const first = await refreshTokenModel.findValidToken(token);
    const second = await refreshTokenModel.findValidToken(token);

    expect(first?.email).toBe(record.email);
    expect(second?.email).toBe(record.email);
    expect(mockCollection.findOne).toHaveBeenCalledTimes(1);
  });

  it('returns null for expired tokens and clears cache entries', async () => {
    const token = 'expired-token';
    const expiredRecord = {
      token,
      email: 'user@example.com',
      expiresAt: makePastDate(),
      createdAt: new Date(),
    };

    mockCollection.findOne.mockResolvedValueOnce(expiredRecord);

    const result = await refreshTokenModel.findValidToken(token);

    expect(result).toBeNull();
    expect(refreshTokenModel.cache.has(token)).toBe(false);
    expect(mockCollection.deleteOne).toHaveBeenCalledWith({ token });
  });

  it('revokes all tokens for a user and clears cache entries', async () => {
    const email = 'user@example.com';
    const cachedToken = 'token-1';
    const anotherToken = 'token-2';

    refreshTokenModel.cache.set(cachedToken, {
      email,
      expiresAt: makeFutureDate(),
      createdAt: new Date(),
      cachedAt: Date.now(),
    });

    refreshTokenModel.cache.set(anotherToken, {
      email: 'other@example.com',
      expiresAt: makeFutureDate(),
      createdAt: new Date(),
      cachedAt: Date.now(),
    });

    mockCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ token: cachedToken }]),
    });
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const deletedCount = await refreshTokenModel.revokeAllTokensForUser(email);

    expect(deletedCount).toBe(1);
    expect(refreshTokenModel.cache.has(cachedToken)).toBe(false);
    expect(refreshTokenModel.cache.has(anotherToken)).toBe(true);
    expect(mockCollection.deleteMany).toHaveBeenCalledWith({ email: email.toLowerCase() });
  });
});
