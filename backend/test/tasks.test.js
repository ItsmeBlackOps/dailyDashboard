import moment from 'moment-timezone';
import request from 'supertest';
import { jest } from '@jest/globals';
import { app, TaskBody } from '../src/index.js';

describe('GET /tasks/today', () => {
  let findSpy;
  const todayEST = moment.tz('America/New_York').format('YYYY-MM-DD');

  beforeEach(() => {
    findSpy = jest.spyOn(TaskBody, 'find');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('requires authentication', async () => {
    findSpy.mockReturnValue({ lean: () => Promise.resolve([]) });
    await request(app).get('/tasks/today').expect(401);
  });

  test('queries for current EST date', async () => {
    findSpy.mockReturnValue({ lean: () => Promise.resolve([]) });
    await request(app).get('/tasks/today').set('x-user-role', 'admin');
    expect(findSpy).toHaveBeenCalledWith({ 'Date of Interview': todayEST });
  });

  test('role-based filtering', async () => {
    const docs = [
      {
        id: 1,
        'Date of Interview': todayEST,
        Replies: [
          { body: 'Assigned To: @john [john@example.com]', receivedDateTime: Date.now() }
        ]
      },
      {
        id: 2,
        'Date of Interview': todayEST,
        Replies: [
          { body: 'Assigned To: @jane [jane@example.com]', receivedDateTime: Date.now() }
        ]
      }
    ];
    findSpy.mockReturnValue({ lean: () => Promise.resolve(docs) });

    const adminRes = await request(app)
      .get('/tasks/today')
      .set('x-user-role', 'admin')
      .expect(200);
    expect(adminRes.body).toHaveLength(2);

    const userRes = await request(app)
      .get('/tasks/today')
      .set('x-user-role', 'user')
      .set('x-user-email', 'john@example.com')
      .expect(200);
    expect(userRes.body).toHaveLength(1);
    expect(userRes.body[0].assignedEmail).toBe('john@example.com');
  });

  test('uses latest assignment email', async () => {
    const docs = [
      {
        'Date of Interview': todayEST,
        Replies: [
          { body: 'Assigned To: @john [john@example.com]', receivedDateTime: Date.now() - 5000 },
          { body: 'Assigned To: @jane [jane@example.com]', receivedDateTime: Date.now() - 1000 }
        ]
      }
    ];
    findSpy.mockReturnValue({ lean: () => Promise.resolve(docs) });

    const res = await request(app)
      .get('/tasks/today')
      .set('x-user-role', 'admin')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].assignedEmail).toBe('jane@example.com');

    const userRes = await request(app)
      .get('/tasks/today')
      .set('x-user-role', 'user')
      .set('x-user-email', 'john@example.com')
      .expect(200);
    expect(userRes.body).toHaveLength(0);
  });
});
