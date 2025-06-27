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
const mongoURI = 'mongodb+srv://USER:***REMOVED-MONGO-PWD***@cluster0.jlncjtp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

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
  },
  'prateek.narvariya@silverspaceinc.com': {
    passwordHash: crypto.createHash('sha256').update('rasilasantra').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel'
  },
    'amartya.kumar@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('N3wP@ssw0rd!1').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'aman.agnihotri@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('Aman$321New').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'harshit@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('H@rsh!t2025').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'Hamid.Ansari@silverspaceinc.com': {
    passwordHash: crypto.createHash('sha256').update('H@midN3xtGen').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'pooja.kumari@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('Pooja#456!New').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'jayshree.rana@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('Jay$hr33@2025').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'vaibhav.kaushik@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('V@ibhav#2025!').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'rahul.agarwal@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('Rahul2025@Up').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'vansh.malhotra@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('V@nsh!Power99').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'Kartikeya.Baijal@silverspaceinc.com': {
    passwordHash: crypto.createHash('sha256').update('K@rtik22#Next').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  },
  'Aayush.Shukla@vizvainc.com': {
    passwordHash: crypto.createHash('sha256').update('A@yush_007x!').digest('hex'),
    role: 'user',
    teamLead: 'Rujuwal Garg',
    manager: 'Harsh Patel',
  }

};

const refreshTokens = new Map();

// --- Helpers to infer full names & teams ---
function getFullNameFromEmail(email) {
  const local = email.split('@')[0];
  const parts = local.split('.');
  if (parts.length < 2) return null;
  const capitalize = s =>
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return parts.map(capitalize).join(' ');
}

function getTeamMembersByLeadName(leadName) {
  return Object.entries(users)
    .filter(([email, info]) => info.teamLead === leadName)
    .map(([email]) => email.toLowerCase());
}

// --- Auth middleware ---
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      req.user = { email: payload.email, role: payload.role };
      console.log(`[Auth] JWT user: ${req.user.email}`);
    } catch {
      console.warn('[Auth] Bad JWT');
    }
  }
  // fallback for tests or manual headers
  if (!req.user) {
    req.user = {
      email: (req.headers['x-user-email'] || '').toString(),
      role: (req.headers['x-user-role'] || 'user').toString()
    };
    console.log(`[Auth] Fallback user: ${req.user.email}`);
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user.email && req.user.role !== 'admin' && req.user.role !== 'lead') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Auth routes ---
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users[email];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== user.passwordHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = { email, role: user.role };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  refreshTokens.set(refreshToken, email);

  res.json({
    accessToken,
    refreshToken,
    role: user.role,
    teamLead: user.teamLead,
    manager: user.manager,
  });
});

app.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || !refreshTokens.has(refreshToken)) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);
    const newToken = jwt.sign({ email: payload.email, role: payload.role }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ accessToken: newToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// --- Get today’s tasks (with team-lead logic) ---
app.get('/tasks/today', requireAuth, async (req, res) => {
  try {
    // 1. Figure out date in EST
    const now = moment.tz('America/New_York');
    const dateStr = now.format('MM/DD/YYYY');

    // 2. Fetch docs
    const docs = await TaskBody.find({ "Date of Interview": dateStr });

    // 3. If you’re a lead, build your report list
    const emailLower = req.user.email.toLowerCase();
    let teamMemberEmails = [];
    if (req.user.role === 'lead') {
      const fullName = getFullNameFromEmail(emailLower);
      if (fullName) {
        teamMemberEmails = getTeamMembersByLeadName(fullName);
      }
    }

    const results = [];

    for (const doc of docs) {
      if (!Array.isArray(doc.replies)) continue;

      // extract all “Assigned To” lines
      const assignments = doc.replies
        .map(r => {
          const m = ASSIGN_REGEX.exec(r.body || '');
          return m
            ? { ts: moment(r.receivedDateTime), email: m[1].toLowerCase() }
            : null;
        })
        .filter(x => x && x.ts.isValid());

      if (!assignments.length) continue;

      // pick the latest
      const latest = assignments.reduce((a, b) =>
        b.ts.isAfter(a.ts) ? b : a
      );

      // check permissions
      const ok =
        req.user.role === 'admin'
        || emailLower === latest.email
        || teamMemberEmails.includes(latest.email);

      if (ok) {
        results.push({
          ...doc,
          assignedEmail: latest.email,
          assignedAt: latest.ts.toISOString(),
        });
      }
    }

    res.json(results);

  } catch (err) {
    console.error('Error in /tasks/today:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Export for tests & run ---
export { app, TaskBody, activityLog };
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3004;
  app.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
}
