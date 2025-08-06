import request from 'supertest';
import { app } from '../src/index.js';

describe('POST /login', () => {
  test('returns tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'admin@example.com', password: 'adminpass' })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  test('rejects invalid password', async () => {
    await request(app)
      .post('/login')
      .send({ email: 'admin@example.com', password: 'wrong' })
      .expect(401);
  });
});

describe('POST /refresh', () => {
  test('returns new access token', async () => {
    const loginRes = await request(app)
      .post('/login')
      .send({ email: 'darshan.singh@vizvainc.com', password: 'userpass' });
    const refreshRes = await request(app)
      .post('/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);
    expect(refreshRes.body.accessToken).toBeDefined();
  });
});
