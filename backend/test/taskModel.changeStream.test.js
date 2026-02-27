import { EventEmitter } from 'events';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

class FakeChangeStream extends EventEmitter {
  constructor() {
    super();
    this.close = jest.fn().mockResolvedValue(undefined);
  }
}

function createSocket(email = 'user@example.com', role = 'user') {
  return {
    data: { user: { email, role, teamLead: '' } },
    emit: jest.fn()
  };
}

function createIo(sockets = []) {
  const map = new Map();
  sockets.forEach((socket, index) => {
    map.set(`socket-${index + 1}`, socket);
  });

  return {
    of: jest.fn(() => ({ sockets: map }))
  };
}

describe('TaskModel change stream realtime mapping', () => {
  let model;
  let userModel;

  beforeEach(() => {
    model = new TaskModel();
    userModel = { getTeamEmails: jest.fn().mockReturnValue([]) };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('watches insert/update/replace/delete with whenAvailable pre-image', () => {
    const stream = new FakeChangeStream();
    const watch = jest.fn(() => stream);
    model.collection = { watch };

    model.setupChangeStream(createIo([createSocket()]), userModel);

    expect(watch).toHaveBeenCalledTimes(1);
    const [pipeline, options] = watch.mock.calls[0];
    expect(pipeline).toEqual([
      { $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }
    ]);
    expect(options).toEqual({
      fullDocument: 'updateLookup',
      fullDocumentBeforeChange: 'whenAvailable'
    });
  });

  it('emits taskCreated for insert events visible to the connected user', async () => {
    const stream = new FakeChangeStream();
    model.collection = { watch: jest.fn(() => stream) };

    const socket = createSocket();
    const io = createIo([socket]);

    jest.spyOn(model, 'formatTask').mockImplementation((doc) => doc);
    jest.spyOn(model, 'shouldSendTaskToUser').mockReturnValue(true);

    model.setupChangeStream(io, userModel);

    stream.emit('change', {
      operationType: 'insert',
      fullDocument: { _id: 'task-1', visibility: 'visible' },
      documentKey: { _id: 'task-1' }
    });

    await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith(
      'taskCreated',
      expect.objectContaining({ _id: 'task-1' })
    );
  });

  it('emits taskRemoved when an update causes visibility loss', async () => {
    const stream = new FakeChangeStream();
    model.collection = { watch: jest.fn(() => stream) };

    const socket = createSocket();
    const io = createIo([socket]);

    jest.spyOn(model, 'formatTask').mockImplementation((doc) => doc);
    jest.spyOn(model, 'shouldSendTaskToUser').mockImplementation((_user, task) => task?.before === true);

    model.setupChangeStream(io, userModel);

    stream.emit('change', {
      operationType: 'update',
      fullDocument: { _id: 'task-2', before: false },
      fullDocumentBeforeChange: { _id: 'task-2', before: true },
      documentKey: { _id: 'task-2' }
    });

    await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith('taskRemoved', { _id: 'task-2' });
  });

  it('emits taskRemoved for delete events to authenticated sockets', async () => {
    const stream = new FakeChangeStream();
    model.collection = { watch: jest.fn(() => stream) };

    const authedSocket = createSocket('a@example.com', 'admin');
    const unauthSocket = { data: {}, emit: jest.fn() };
    const io = createIo([authedSocket, unauthSocket]);

    model.setupChangeStream(io, userModel);

    stream.emit('change', {
      operationType: 'delete',
      documentKey: { _id: 'task-3' }
    });

    await Promise.resolve();
    expect(authedSocket.emit).toHaveBeenCalledWith('taskRemoved', { _id: 'task-3' });
    expect(unauthSocket.emit).not.toHaveBeenCalled();
  });

  it('does not crash when pre-image is missing and still emits update for visible docs', async () => {
    const stream = new FakeChangeStream();
    model.collection = { watch: jest.fn(() => stream) };

    const socket = createSocket();
    const io = createIo([socket]);

    jest.spyOn(model, 'formatTask').mockImplementation((doc) => doc);
    jest.spyOn(model, 'shouldSendTaskToUser').mockImplementation((_user, task) => Boolean(task?.visible));

    model.setupChangeStream(io, userModel);

    stream.emit('change', {
      operationType: 'update',
      fullDocument: { _id: 'task-4', visible: true },
      fullDocumentBeforeChange: null,
      documentKey: { _id: 'task-4' }
    });

    await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith(
      'taskUpdated',
      expect.objectContaining({ _id: 'task-4', visible: true })
    );
  });

  it('restarts the stream with backoff on error and prevents duplicate restart scheduling', async () => {
    jest.useFakeTimers();

    const firstStream = new FakeChangeStream();
    const secondStream = new FakeChangeStream();
    const watch = jest
      .fn()
      .mockReturnValueOnce(firstStream)
      .mockReturnValueOnce(secondStream);
    model.collection = { watch };

    model.setupChangeStream(createIo([createSocket()]), userModel);
    expect(watch).toHaveBeenCalledTimes(1);

    firstStream.emit('error', new Error('stream failed #1'));

    await Promise.resolve();
    expect(firstStream.close).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(1);

    // Ensure duplicate restart scheduling is ignored while a timer is active.
    model.scheduleTaskChangeStreamRestart(new Error('duplicate schedule attempt'));

    await jest.advanceTimersByTimeAsync(1000);
    expect(watch).toHaveBeenCalledTimes(2);
  });
});
