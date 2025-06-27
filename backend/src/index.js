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
  'rujuwal.garg@silverspaceinc.com': {
  passwordHash: crypto.createHash('sha256').update('Rujuwal#2025!').digest('hex'),
  role: 'lead',
  teamLead: '', // He’s the lead, so no one leads him
  manager: 'Harsh Patel'
  },
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

// const refreshTokens = new Map();

// --- Helpers to infer full names & teams ---
function getUserByEmail(email) {
  const lower = email.toLowerCase();
  for (const key of Object.keys(users)) {
    if (key.toLowerCase() === lower) {
      return { email: key, ...users[key] };
    }
  }
  return null;
}

// Helper to get all direct reports of a lead by their full name
function getTeamMembersByLeadName(leadName) {
  return Object.entries(users)
    .filter(([_, u]) => u.teamLead === leadName)
    .map(([email]) => email.toLowerCase());
}

// --- Auth middleware: extract email from JWT or header, then look up role/etc ---
app.use((req, res, next) => {
  let email;

  // 1) Try JWT
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      email = payload.email;
    } catch {
      console.warn('[Auth] Invalid JWT');
    }
  }

  // 2) Fallback for tests (or manual dev): x-user-email header
  if (!email && req.headers['x-user-email']) {
    email = req.headers['x-user-email'].toString();
  }

  if (email) {
    const user = getUserByEmail(email);
    if (user) {
      req.user = {
        email:    user.email,
        role:     user.role,
        teamLead: user.teamLead,
        manager:  user.manager,
      };
      console.log(`[Auth] User: ${user.email} (${user.role})`);
    } else {
      console.warn(`[Auth] No user record for: ${email}`);
    }
  }

  next();
});

// Only allow through if we found a user record
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: no valid user' });
  }
  next();
}

// --- Login & token endpoints ---
// Note: we only embed email in JWT, never role
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== user.passwordHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Sign only the email
  const accessToken  = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  refreshTokens.set(refreshToken, user.email);

  res.json({
    accessToken,
    refreshToken,
    role:     user.role,
    teamLead: user.teamLead,
    manager:  user.manager,
  });
});

const refreshTokens = new Map();
app.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || !refreshTokens.has(refreshToken)) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  try {
    const payload     = jwt.verify(refreshToken, JWT_SECRET);
    const accessToken = jwt.sign({ email: payload.email }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// --- GET /tasks/today ---
// Leads see tasks assigned to anyone they lead.
// Admins see everything.  
// Users only see their own.
app.get('/tasks/today', requireAuth, async (req, res) => {
  try {
    // Today's date string in EST
    const now     = moment.tz('America/New_York');
    const dateStr = now.format('MM/DD/YYYY');

    // Fetch all docs for today
    const docs = await TaskBody.find({ "Date of Interview": dateStr });

    // If you’re a lead, build your team’s email list
    const lowerEmail = req.user.email.toLowerCase();
    let teamEmails   = [];
    if (req.user.role === 'lead') {
      // full name = First Last from email
      const [first, last] = req.user.email.split('@')[0].split('.');
      const fullName = first && last
        ? `${first[0].toUpperCase()}${first.slice(1)} ${last[0].toUpperCase()}${last.slice(1)}`
        : '';
      teamEmails = getTeamMembersByLeadName(fullName);
    }

    const results = [];

    for (const doc of docs) {
      if (!Array.isArray(doc.replies)) continue;

      // parse all “Assigned To” replies
      const assignments = doc.replies
        .map(r => {
          const m = ASSIGN_REGEX.exec(r.body || '');
          return m
            ? { ts: moment(r.receivedDateTime), email: m[1].toLowerCase() }
            : null;
        })
        .filter(x => x && x.ts.isValid());

      if (!assignments.length) continue;

      // pick the latest assignment
      const latest = assignments.reduce((a, b) => b.ts.isAfter(a.ts) ? b : a);

      const assignedTo = latest.email;
      const allowed = (
          req.user.role === 'admin' ||
          lowerEmail === assignedTo        ||
          teamEmails.includes(assignedTo)
      );
      if (allowed) {
        results.push({
          ...doc,
          assignedEmail: latest.email,
          assignedAt:    latest.ts.toISOString(),
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('❌ /tasks/today error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { app, TaskBody, activityLog };

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3004;
  app.listen(PORT, () => console.log(`🚀 Server up on ${PORT}`));
}
