import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import cors from 'cors';
import morgan from 'morgan';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors());

// MongoDB connection
const mongoURI = process.env.MONGODB_URI;
if (process.env.NODE_ENV !== 'test') {
  if (!mongoURI) {
    console.error('MONGODB_URI is not defined');
    process.exit(1);
  }

  mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const db = mongoose.connection;
  db.on('error', (err) => console.error('MongoDB connection error:', err));
  db.once('open', () => console.log('Connected to MongoDB'));
}

// Schema definition for interviewSupport.taskBody
const taskBodySchema = new mongoose.Schema({}, { strict: false });
const TaskBody = mongoose.model('TaskBody', taskBodySchema, 'interviewSupport.taskBody');

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
    teamLead: 'Lead B',
    manager: 'Manager B',
  },
};

const refreshTokens = new Map();

/**
 * Middleware to simulate authentication.
 * Expects req.user to be populated.
 */
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { email: payload.email, role: payload.role };
    } catch {
      // ignore invalid token
    }
  }

  if (!req.user) {
    const role = req.headers['x-user-role'];
    const email = req.headers['x-user-email'];
    req.user = { role: role || 'user', email: email || '' };
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user?.email && req.user?.role !== 'admin') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

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
    const accessToken = jwt.sign({ email: payload.email, role: payload.role }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

app.get('/tasks/today', requireAuth, async (req, res) => {
  try {
    const now = moment.tz('America/New_York');
    const dateStr = now.format('YYYY-MM-DD');

    const docs = await TaskBody.find({ 'Date of Interview': dateStr }).lean();

    const cutoff = moment.tz('23:59', 'HH:mm', 'America/New_York');
    const results = [];

    for (const doc of docs) {
      if (!Array.isArray(doc.Replies)) continue;
      let latestAssign = null;

      for (const reply of doc.Replies) {
        const text = reply?.body || reply;
        const timestamp = moment(reply?.receivedDateTime || 0);
        const assignMatch = ASSIGN_REGEX.exec(text);
        const emailMatch = EMAIL_REGEX.exec(text);
        if (assignMatch && emailMatch) {
          if (!latestAssign || moment(reply.receivedDateTime).isAfter(moment(latestAssign.timestamp))) {
            latestAssign = { email: emailMatch[0], timestamp: timestamp };
          }
        }
      }

      if (latestAssign && latestAssign.timestamp.isBefore(cutoff)) {
        if (req.user.role === 'admin' || req.user.email === latestAssign.email) {
          results.push({ ...doc, assignedEmail: latestAssign.email });
        }
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { app, TaskBody };

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
