
import { notificationModel } from './src/models/Notification.js';
import { database } from './src/config/database.js';
import { ObjectId } from 'mongodb';

async function testDeduplication() {
    console.log('Starting deduplication test...');

    // Mock database connection
    const mockCollection = {
        createIndex: jest.fn(),
        updateOne: jest.fn().mockResolvedValue({ upsertedId: new ObjectId() }),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() })
    };

    const mockDb = {
        collection: jest.fn().mockReturnValue(mockCollection)
    };

    database.getDatabase = jest.fn().mockReturnValue(mockDb);
    database.getCollection = jest.fn().mockReturnValue(mockCollection);

    // Test data
    const recipient = 'test@example.com';
    const eventId = 'event-123';
    const payload = {
        recipient,
        eventId,
        title: 'Test Notification',
        description: 'Testing deduplication'
    };

    // First Call
    console.log('Attempting first creation...');
    const result1 = await notificationModel.createNotification(payload);
    console.log('Result 1:', result1);

    // Second Call (Duplicate)
    console.log('Attempting second creation (duplicate)...');
    const result2 = await notificationModel.createNotification(payload);
    console.log('Result 2:', result2);

    // Assertions
    // We expect updateOne to be called twice with upsert: true
    // In a real Mongo environment, the second call would not return an upsertedId if it matched.
    // Since we are mocking, we can just verify the arguments to updateOne.

    // Check if updateOne was called with correct filter and options
    const updateCalls = mockCollection.updateOne.mock.calls;
    console.log(`updateOne called ${updateCalls.length} times`);

    if (updateCalls.length !== 2) {
        console.error('FAILED: updateOne should be called twice');
        return;
    }

    const firstCallArgs = updateCalls[0];
    const filter1 = firstCallArgs[0];
    const options1 = firstCallArgs[2];

    if (filter1.recipient !== recipient || filter1.eventId !== eventId) {
        console.error('FAILED: Filter incorrect on first call', filter1);
        return;
    }
    if (!options1.upsert) {
        console.error('FAILED: upsert option missing on first call');
        return;
    }

    console.log('PASSED: Deduplication logic verification successful (Method signature check)');
}

// Simple mock setup for standalone run without Jest
const jest = {
    fn: () => {
        const mock = (...args) => {
            mock.calls.push(args);
            return mock.returnValue;
        };
        mock.calls = [];
        mock.mockReturnValue = (val) => {
            mock.returnValue = val;
            return mock;
        };
        mock.mockResolvedValue = (val) => {
            mock.returnValue = Promise.resolve(val);
            return mock;
        };
        return mock;
    }
};

testDeduplication().catch(console.error);
