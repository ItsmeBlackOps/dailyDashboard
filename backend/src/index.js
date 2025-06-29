// index.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { MongoClient, ObjectId } from 'mongodb';
import moment from 'moment-timezone';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import cors from 'cors';
import morgan from 'morgan';


// --- Environment & Config ---
const { JWT_SECRET = 'secret', MONGODB_URI } = process.env;
const mongoURI = MONGODB_URI ||
  'mongodb+srv://USER:***REMOVED-MONGO-PWD***@cluster0.jlncjtp.mongodb.net/?retryWrites=true&w=majority';
const PORT = process.env.PORT || 3004;

// --- Express Setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// --- In-memory Refresh Token Store ---
const refreshTokens = new Map();

// --- In-memory Refresh Token Store ---
// --- User store & helpers ---
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


function getUserByEmail(email) {
  const lower = email.toLowerCase();
  return Object.entries(users).find(([key]) => key.toLowerCase() === lower)?.[1] || null;
}

// --- MongoDB Connection ---
let taskBodyCollection;
async function connectMongo() {
  console.log('🚀 Connecting to MongoDB...');
  const client = new MongoClient(mongoURI);
  await client.connect();
  const db = client.db('interviewSupport');
  taskBodyCollection = db.collection('taskBody');
  console.log('✅ Connected to MongoDB');
}
await connectMongo();

// --- HTTP Server & Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] }});

// --- Socket Authentication Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();
  try {
    const { email } = jwt.verify(token, JWT_SECRET);
    const user = getUserByEmail(email);
    if (!user) throw new Error();
    socket.data.user = { email, role: user.role, teamLead: user.teamLead, manager: user.manager };
    console.log(`[Auth] Socket authenticated: ${email}`);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

// --- Socket.IO Event Handling ---
io.on('connection', socket => {
  console.log(`🔌 Socket connected [id=${socket.id}]`);

  socket.on('login', ({ email, password }, callback) => {
    try {
      const user = getUserByEmail(email);
      if (!user) throw new Error('Invalid credentials');
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (hash !== user.passwordHash) throw new Error('Invalid credentials');

      const accessToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '15m' });
      const refreshToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
      refreshTokens.set(refreshToken, email);

      socket.data.user = { email, role: user.role, teamLead: user.teamLead, manager: user.manager };
      console.log(`[Auth] ${email} logged in via socket`);

      callback({ success: true, accessToken, refreshToken, role: user.role, teamLead: user.teamLead, manager: user.manager });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });
  socket.on('refresh', ({ refreshToken }, callback) => {
    try {
      // 1) Check we issued it
      if (!refreshToken || !refreshTokens.has(refreshToken)) {
        return callback({ success: false, error: 'Invalid refresh token' });
      }
      // 2) Verify & re‐sign a fresh access token
      const { email } = jwt.verify(refreshToken, JWT_SECRET);
      const accessToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '15m' });
      callback({ success: true, accessToken });
    } catch (err) {
      callback({ success: false, error: 'Invalid refresh token' });
    }
  });

  socket.on('getTasksToday', async callback => {
  const authUser = socket.data.user;
  if (!authUser) return callback({ success: false, error: 'Unauthorized' });

  try {
    const todayStr = moment.tz('America/New_York').format('MM/DD/YYYY');
    const docs = await taskBodyCollection
      .find({ 'Date of Interview': '06/30/2025' })
      .toArray();

    const lowerEmail = authUser.email.toLowerCase();
    let teamEmails = [];
    if (authUser.role === 'lead') {
      const [first, last] = lowerEmail.split('@')[0].split('.');
      const fullName = `${first[0].toUpperCase()}${first.slice(1)} ` +
                       `${last[0].toUpperCase()}${last.slice(1)}`;
      teamEmails = Object.entries(users)
        .filter(([,u]) => u.teamLead === fullName)
        .map(([e]) => e.toLowerCase());
    }

    const tasks = [];

    for (const doc of docs) {
      if (!Array.isArray(doc.replies)) continue;
      // find the latest “Assigned To” reply
      const assignments = doc.replies
      .map(r => {
        const m = /Assigned To: @.+\[(.+?)\]/i.exec(r.body);
        return m && moment(r.receivedDateTime).isValid()
        ? { ts: moment(r.receivedDateTime), email: m[1].toLowerCase() }
        : null;
      })
      .filter(Boolean);
      if (!assignments.length) continue;
      
      const latest = assignments.reduce((a, b) => b.ts.isAfter(a.ts) ? b : a);
      const assignedTo = latest.email;
      const allowed = authUser.role === 'admin'
      || lowerEmail === assignedTo
      || teamEmails.includes(assignedTo);
      if (!allowed) continue;
      
      // parse full datetime strings into Date objects
      const startMoment = moment.tz(
        `${doc['Date of Interview']} ${doc['Start Time Of Interview']}`,
        'MM/DD/YYYY HH:mm',
        'America/New_York'
      );
      const endMoment = moment.tz(
        `${doc['Date of Interview']} ${doc['End Time Of Interview']}`,
        'MM/DD/YYYY HH:mm',
        'America/New_York'
      );
      
      // standardized fields
      const startTime = startMoment.toDate();
      const endTime   = endMoment.toDate();
      
      const [f, l] = assignedTo.split('@')[0].split('.');
      tasks.push({
        ...doc,
        assignedExpert: `${f[0].toUpperCase()}${f.slice(1)} ` +
        `${l[0].toUpperCase()}${l.slice(1)}`,
        assignedEmail: assignedTo,
        assignedAt: latest.ts.toISOString(),
        startTime,
        endTime
      });
      
    }

    // **Sort once, outside the loop**:
    //  - by startTime ascending
    //  - tie-break by endTime ascending
    tasks.sort((a, b) => {
      const diff = a.startTime - b.startTime;
      if (diff !== 0) return diff;
      return a.endTime - b.endTime;
    });
    console.log(tasks)
    callback({ success: true, tasks });
  } catch (err) {
    callback({ success: false, error: err.message });
  }
});


  socket.on('disconnect', reason => console.log(`❌ Socket disconnected [id=${socket.id}] reason: ${reason}`));
});

// --- Start Server ---
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
