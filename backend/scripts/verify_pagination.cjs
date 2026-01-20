
const axios = require('axios');

const API_URL = 'http://localhost:3004';
const EMAIL = 'harsh.patel@silverspaceinc.com';
const PASSWORD = 'Hkpatel@21';

async function verify() {
    try {
        // 1. Login
        console.log(`Logging in as ${EMAIL}...`);
        const loginResp = await axios.post(`${API_URL}/api/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });

        const token = loginResp.data.token;
        if (!token) throw new Error('No token received');
        console.log('Login successful.');

        // 2. Fetch Page 1 (Limit 5)
        console.log('Fetching Page 1 (limit=5, offset=0)...');
        const page1 = await axios.get(`${API_URL}/api/tasks?limit=5&offset=0`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const tasks1 = page1.data.tasks;
        console.log(`Page 1 returned ${tasks1.length} tasks.`);
        if (tasks1.length > 5) console.error('FAIL: Returned more than 5 tasks!');

        if (tasks1.length === 0) {
            console.warn('No tasks found to verify pagination.');
            return;
        }

        // 3. Fetch Page 2 (Limit 5, Offset 5)
        console.log('Fetching Page 2 (limit=5, offset=5)...');
        const page2 = await axios.get(`${API_URL}/api/tasks?limit=5&offset=5`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const tasks2 = page2.data.tasks;
        console.log(`Page 2 returned ${tasks2.length} tasks.`);

        // 4. Verify no overlap (simple check of IDs)
        const ids1 = new Set(tasks1.map(t => t._id));
        const ids2 = new Set(tasks2.map(t => t._id));
        const overlap = [...ids1].filter(x => ids2.has(x));

        if (overlap.length > 0) {
            console.error('FAIL: Overlap detected between pages:', overlap);
        } else {
            console.log('SUCCESS: No overlap between pages.');
        }

        // 5. Verify Sort Order (Newest First)
        // Check if first task of page 1 is newer than first task of page 2?
        // Since we used _id sort (-1), newer IDs should be in Page 1.
        if (tasks1.length > 0 && tasks2.length > 0) {
            // Simple string comparison for MongoIDs roughly works for timestamp
            if (tasks1[0]._id > tasks2[0]._id) {
                console.log('SUCCESS: Page 1 ID is > Page 2 ID (Newest First confirmed).');
            } else {
                console.warn('WARNING: IDs might not be sorted as expected:', tasks1[0]._id, tasks2[0]._id);
            }
        }

    } catch (error) {
        console.error('Verification Failed:', error.message);
        if (error.response) console.error('Response:', error.response.data);
    }
}

verify();
