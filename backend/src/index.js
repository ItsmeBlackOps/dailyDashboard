import dotenv from 'dotenv';
import express from 'express';
import { MongoClient } from 'mongodb';
import moment from 'moment-timezone';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import cors from 'cors';
import morgan from 'morgan';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const mongoURI = 'mongodb+srv://harshpsilverspace:space123@cluster0.jlncjtp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors());

// --- MongoClient setup ---
let taskBodyCollection = null;

async function connectMongo() {
  const client = new MongoClient(mongoURI);
  await client.connect();
  const db = client.db('interviewSupport'); // uses database from URI
  taskBodyCollection = db.collection('taskBody');
}

// only connect in non-test env
if (process.env.NODE_ENV !== 'test') {
  if (!mongoURI) {
    console.error('❌ MONGODB_URI is not defined');
    process.exit(1);
  }
  connectMongo()
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1);
    });
}

// Plain JS “model” with a stub‐able find() for your tests
const TaskBody = {
  find: async (filter = {}) => {
    if (!taskBodyCollection) {
      throw new Error('MongoDB client not initialized');
    }
    return taskBodyCollection.find(filter).toArray();
  }
};

// In-memory log for activity posts
const activityLog = [];

const ASSIGN_REGEX = /Assigned\s+To:\s*@[^\s]+\s*\[([^\]]+)\]/i;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const users = {
  'admin@example.com': {
    passwordHash: crypto.createHash('sha256').update('adminpass').digest('hex'),
    role: 'admin',
    teamLead: 'Lead A',
    manager: 'Manager A',
  },
  'darshan.singh@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('userpass').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'aditya.sharma@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('asharma123').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel'
  },
  'ajay.krishna@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('ajshna@123').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel'
  },
  'anusree.vasudevan@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('sree123').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel'
  }
};

const refreshTokens = new Map();

// --- auth middleware ---
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { email: payload.email, role: payload.role };
      console.log(`[Auth] User from JWT: ${req.user.email}`);
    } catch {
      console.warn('[Auth] Invalid JWT token');
    }
  }

  if (!req.user) {
    const role = req.headers['x-user-role'];
    const email = req.headers['x-user-email'];
    req.user = { role: role || 'user', email: email || '' };
    console.log(`[Auth] Fallback user: ${req.user.email}`);
  }

  next();
});

function requireAuth(req, res, next) {
  if (!req.user?.email && req.user?.role !== 'admin') {
    console.warn('[Auth] Unauthorized access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- endpoints ---

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user) {
    console.warn(`[Login] Invalid user: ${email}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== user.passwordHash) {
    console.warn(`[Login] Invalid password for ${email}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = { email, role: user.role };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  refreshTokens.set(refreshToken, email);

  console.log(`[Login] Successful login for ${email}`);

  res.json({
    accessToken,
    refreshToken,
    role: user.role,
    teamLead: user.teamLead,
    manager: user.manager,
  });
});

// Refresh
app.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || !refreshTokens.has(refreshToken)) {
    console.warn('[Refresh] Invalid refresh token');
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);
    const accessToken = jwt.sign({ email: payload.email, role: payload.role }, JWT_SECRET, { expiresIn: '15m' });
    console.log(`[Refresh] Refreshed token for ${payload.email}`);
    res.json({ accessToken });
  } catch {
    console.warn('[Refresh] Failed to verify refresh token');
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Get tasks for today
app.get('/tasks/today', requireAuth, async (req, res) => {
  try {
    const now = moment.tz('America/New_York');
    const dateStr = now.format('MM/DD/YYYY');
    console.log(`[Tasks GET] Looking for tasks on ${dateStr}`);

    const docs = await TaskBody.find({"Date of Interview": dateStr});
    console.log(`[Tasks GET] Found ${docs.length} documents for today`);

    const cutoff = moment.tz('23:59', 'HH:mm', 'America/New_York');
    const results = [];

    for (const doc of docs) {
      if (!Array.isArray(doc.replies)) continue;

      // 1) collect all (timestamp, email) pairs
      const assignments = [];
      for (const reply of doc.replies) {
        const text = reply?.body ?? '';
        // console.log(text)
        const m    = /Assigned To: @.+\[(.+?)\]/i.exec(text);
        if (!m) continue;
        // console.log(m[1]);

        const ts = moment(reply.receivedDateTime); 
        if (!ts.isValid()) continue;

        assignments.push({ timestamp: ts, email: m[1] });
      }

      // 2) if none found, skip
      if (assignments.length === 0) continue;

      // 3) pick the one with the latest timestamp
      const latest = assignments.reduce((a, b) =>
        b.timestamp.isAfter(a.timestamp) ? b : a
      );
      console.log(req.user.email, `===`, latest.email)
      // 4) filter by cutoff and user permissions
        if (req.user.role === 'admin' || req.user.email === latest.email.toLowerCase()) {
          results.push({
            ...doc,
            assignedEmail: latest.email,
            assignedAt:    latest.timestamp.toISOString(),
          });
        }
      
    }

    return res.json(results);


  } catch (err) {
    console.error('❌ Error in /tasks/today GET:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { app, TaskBody, activityLog };

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
