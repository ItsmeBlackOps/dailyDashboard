import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import moment from 'moment-timezone';

const REQUIRED_ENV = ['MONGODB_URI'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'interviewSupport';
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000
});

const testEmail = (process.env.TEST_USER_EMAIL || 'ci.admin@example.com').toLowerCase();
const testPassword = process.env.TEST_USER_PASSWORD || 'P@ssw0rd!';
const testRole = process.env.TEST_USER_ROLE || 'admin';

const now = new Date();
const timezone = 'America/New_York';
const today = moment.tz(timezone);

const buildTask = ({
  candidateName,
  actualRound,
  assignedTo,
  assignedExpert,
  assignedToEmail,
  sender,
  cc,
  status,
  branch,
  hourOffset = 9
}) => {
  const start = today.clone().hour(hourOffset).minute(0).second(0).millisecond(0);
  const end = start.clone().add(45, 'minutes');

  return {
    'Candidate Name': candidateName,
    actualRound,
    assignedTo,
    assignedExpert,
    assignedToEmail,
    sender,
    cc,
    status,
    Branch: branch,
    to: `${candidateName.split(' ')[0].toLowerCase()}.${candidateName.split(' ')[1]?.toLowerCase() || 'hr'}@example.com`,
    receivedDateTime: start.toISOString(),
    'Date of Interview': today.format('MM/DD/YYYY'),
    'Start Time Of Interview': start.format('hh:mm A'),
    'End Time Of Interview': end.format('hh:mm A'),
    assignedAt: start.toDate(),
    createdAt: start.toDate(),
    updatedAt: end.toDate(),
    _last_write: end.toDate()
  };
};

const createTasks = () => [
  buildTask({
    candidateName: 'Alice Johnson',
    actualRound: 'Technical Round',
    assignedTo: 'Lead A',
    assignedExpert: 'Lead A',
    assignedToEmail: 'lead.a@example.com',
    sender: 'recruiter.one@example.com',
    cc: 'manager.a@example.com',
    status: 'Scheduled',
    branch: 'GGR',
    hourOffset: 9
  }),
  buildTask({
    candidateName: 'Brian Edwards',
    actualRound: 'HR Round',
    assignedTo: 'Lead A',
    assignedExpert: 'Lead A',
    assignedToEmail: 'lead.a@example.com',
    sender: 'recruiter.two@example.com',
    cc: 'manager.a@example.com',
    status: 'Interview Completed',
    branch: 'LKN',
    hourOffset: 11
  }),
  buildTask({
    candidateName: 'Carla Mendes',
    actualRound: 'Manager Round',
    assignedTo: 'Lead A',
    assignedExpert: 'Lead A',
    assignedToEmail: 'lead.a@example.com',
    sender: 'recruiter.three@example.com',
    cc: 'manager.a@example.com',
    status: 'Pending Feedback',
    branch: 'AHM',
    hourOffset: 13
  })
];

const seedCandidate = () => ({
  Branch: 'GGR',
  Recruiter: 'recruiter.one@example.com',
  Expert: 'Lead A',
  Technology: 'React',
  'Candidate Name': 'Alice Johnson',
  'Email ID': 'alice.johnson@example.com',
  'Contact No': '+11234567890',
  workflowStatus: 'awaiting_expert',
  resumeUnderstandingStatus: 'pending',
  createdBy: testEmail,
  updated_at: now,
  _last_write: now,
  created_at: now
});

const createTestUser = () => ({
  email: testEmail,
  passwordHash: crypto.createHash('sha256').update(testPassword).digest('hex'),
  role: testRole,
  teamLead: 'Lead A',
  manager: 'Manager A',
  active: true,
  createdAt: now,
  updatedAt: now
});

try {
  await client.connect();
  const db = client.db(dbName);

  await Promise.all([
    db.collection('users').deleteMany({}),
    db.collection('taskBody').deleteMany({}),
    db.collection('candidateDetails').deleteMany({}),
    db.collection('refreshTokens').deleteMany({})
  ]);

  await db.collection('users').insertOne(createTestUser());
  await db.collection('taskBody').insertMany(createTasks());
  await db.collection('candidateDetails').insertOne(seedCandidate());

  console.log('✅ Seeded MongoDB test data');
} catch (error) {
  console.error('❌ Failed to seed MongoDB test data', error);
  process.exitCode = 1;
} finally {
  await client.close();
}
