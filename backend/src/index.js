// index.js
import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { MongoClient, ObjectId } from "mongodb";
import moment from "moment-timezone";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import cors from "cors";
import morgan from "morgan";

// --- Environment & Config ---
const { JWT_SECRET = "secret", MONGODB_URI } = process.env;
const mongoURI = MONGODB_URI
const PORT = process.env.PORT || 3004;

// --- Express Setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// --- In-memory Refresh Token Store ---
const refreshTokens = new Map();

// --- In-memory Refresh Token Store ---
// --- User store & helpers ---
const users = new Map();

async function loadUsers() {
  const all = await db.collection('users').find().toArray();
  users.clear();
  for (const u of all) {
    users.set(u.email.toLowerCase(), {
      passwordHash: u.passwordHash,
      role:         u.role,
      teamLead:     u.teamLead,
      manager:      u.manager,
    });
  }
  console.log(`✅ Loaded ${users.size} users`);
}

// then, after you do `await client.connect()` in your initMongo/initDB function:
await loadUsers();

// (optional) watch for changes in the users collection and update cache:
const usersStream = db.collection('users').watch();
usersStream.on('change', async change => {
  if (change.operationType === 'delete') {
    // simplest: just reload everything
    await loadUsers();
  } else {
    // insert/replace/update:
    const doc = change.fullDocument || await db.collection('users').findOne({ _id: change.documentKey._id });
    users.set(doc.email.toLowerCase(), {
      passwordHash: doc.passwordHash,
      role:         doc.role,
      teamLead:     doc.teamLead,
      manager:      doc.manager,
    });
    console.log(`🔄 User cache upserted: ${doc.email}`);
  }
});

function getUserByEmail(email) {
  const lower = email.toLowerCase();
  return (
    Object.entries(users).find(([key]) => key.toLowerCase() === lower)?.[1] ||
    null
  );
}

function formatTask(doc) {
  // 1) Parse the interview window up front:
  const dateStr = doc["Date of Interview"];
  const startStr = doc["Start Time Of Interview"];
  const endStr   = doc["End Time Of Interview"];
  const startMoment = moment.tz(
    `${dateStr} ${startStr}`,
    "MM/DD/YYYY HH:mm",
    "America/New_York"
  );
  const endMoment = moment.tz(
    `${dateStr} ${endStr}`,
    "MM/DD/YYYY HH:mm",
    "America/New_York"
  );

  // If the core date/times aren’t valid, skip (still returns null)
  if (!startMoment.isValid() || !endMoment.isValid()) {
    console.log("Invalid interview times, skipping task", doc._id);
    return null;
  }

  // 2) Default values when nobody’s been assigned yet:
  let assignedExpert = "Not Assigned";
  let assignedEmail  = null;
  let assignedAt     = null;

  // 3) If we have replies, look for “Assigned To” stamps:
  if (Array.isArray(doc.replies)) {
    const assignments = doc.replies
      .map((r) => {
        const m = /Assigned To: @.+\[(.+?)\]/i.exec(r.body);
        if (m && moment(r.receivedDateTime).isValid()) {
          return {
            ts:    moment(r.receivedDateTime),
            email: m[1].toLowerCase(),
          };
        }
        return null;
      })
      .filter(Boolean);

    if (assignments.length) {
      // pick the latest one
      const latest = assignments.reduce((a, b) => (b.ts.isAfter(a.ts) ? b : a));
      assignedEmail = latest.email;
      assignedAt    = latest.ts.toISOString();

      // turn “first.last” → “First Last”
      const parts = assignedEmail.split("@")[0].split(".");
      assignedExpert = parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
    }
  }

  // 4) Return the task object with guaranteed shape
  return {
    ...doc,
    assignedExpert,
    assignedEmail,
    assignedAt,
    startTime: startMoment.toDate(),
    endTime:   endMoment.toDate(),
  };
}

function shouldSendTask(user, assignedEmail) {
  const lowerEmail = user.email.toLowerCase();
  let teamEmails = [];
  if (user.role === "lead") {
    const [first, last] = lowerEmail.split("@")[0].split(".");
    const fullName = `${first[0].toUpperCase()}${first.slice(1)} ${last[0].toUpperCase()}${last.slice(1)}`;
    teamEmails = Object.entries(users)
      .filter(
        ([mail, u]) =>
          u.teamLead === fullName || mail.toLowerCase() === lowerEmail,
      )
      .map(([e]) => e.toLowerCase());
  }

  return (
    user.role === "admin" ||
    lowerEmail === assignedEmail.toLowerCase() ||
    teamEmails.includes(assignedEmail.toLowerCase())
  );
}

function emitToRelevant(event, task) {
  for (const socket of io.of("/").sockets.values()) {
    const user = socket.data.user;
    if (!user) continue;
    if (shouldSendTask(user, task.assignedEmail)) {
      socket.emit(event, task);
    }
  }
}

// --- MongoDB Connection ---
let taskBodyCollection;
async function connectMongo() {
  console.log("🚀 Connecting to MongoDB...");
  const client = new MongoClient(mongoURI);
  await client.connect();
  const db = client.db("interviewSupport");
  taskBodyCollection = db.collection("taskBody");
  console.log("✅ Connected to MongoDB");

  // WATCH FOR REAL-TIME CHANGES IN taskBody
  const changeStream = taskBodyCollection.watch([
    { $match: { operationType: { $in: ["insert", "update"] } } },
  ]);

  changeStream.on("change", async (change) => {
    try {
      const doc =
        change.operationType === "insert"
          ? change.fullDocument
          : await taskBodyCollection.findOne({ _id: change.documentKey._id });
      const formatted = formatTask(doc);
      if (!formatted) return;
      const event =
        change.operationType === "insert" ? "taskCreated" : "taskUpdated";
      console.log(`[changeStream] ${event} for ${formatted.assignedEmail}`);
      emitToRelevant(event, formatted);
    } catch (err) {
      console.error("Change stream processing error:", err);
    }
  });

  changeStream.on("error", (err) => {
    console.error("Change stream error:", err);
  });
}

// --- HTTP Server & Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

await connectMongo();

// --- Socket Authentication Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();
  try {
    const { email } = jwt.verify(token, JWT_SECRET);
    const user = getUserByEmail(email);
    if (!user) throw new Error();
    socket.data.user = {
      email,
      role: user.role,
      teamLead: user.teamLead,
      manager: user.manager,
    };
    console.log(`[Auth] Socket authenticated: ${email}`);
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

// --- Socket.IO Event Handling ---
io.on("connection", (socket) => {
  console.log(`🔌 Socket connected [id=${socket.id}]`);

  socket.on("login", ({ email, password }, callback) => {
    try {
      const user = getUserByEmail(email);
      if (!user) throw new Error("Invalid credentials");
      const hash = crypto.createHash("sha256").update(password).digest("hex");
      if (hash !== user.passwordHash) throw new Error("Invalid credentials");

      const accessToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "15m" });
      const refreshToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
      refreshTokens.set(refreshToken, email);

      socket.data.user = {
        email,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager,
      };
      console.log(`[Auth] ${email} logged in via socket`);

      callback({
        success: true,
        accessToken,
        refreshToken,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager,
      });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });
  socket.on("refresh", ({ refreshToken }, callback) => {
    try {
      // 1) Check we issued it
      if (!refreshToken || !refreshTokens.has(refreshToken)) {
        return callback({ success: false, error: "Invalid refresh token" });
      }
      // 2) Verify & re‐sign a fresh access token
      const { email } = jwt.verify(refreshToken, JWT_SECRET);
      const accessToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "15m" });
      callback({ success: true, accessToken });
    } catch (err) {
      callback({ success: false, error: "Invalid refresh token" });
    }
  });

  socket.on("getTasksToday", async (payload, callback) => {
    console.log(payload);
    const authUser = socket.data.user;
    console.log(authUser);
    if (!authUser) return callback({ success: false, error: "Unauthorized" });

    try {
      const todayStr = moment.tz("America/New_York").format("MM/DD/YYYY");
      const todayIso    = moment.tz("America/New_York").format("YYYY-MM-DD");
      console.log(todayIso);
      // console.log(socket.data);
      console.log(
        `[getTasksToday] ${authUser.email} requested tasks for ${todayStr}`,
      );
      let query;
      const field = String(payload.tab);
      if (authUser.role === "MAM" || authUser.role === "MM") {
        const mngr = authUser.manager.toLowerCase().split(' ').join('.');
        const ccVal = authUser.role === "MM" ? authuser.email.split('@')[0] : mngr;
  if (field === "Date of Interview") {
    // direct match on todayStr for the Date of Interview field
    query = {
      [field]: todayStr,
      cc:      { $regex: ccVal, $options: 'i' }
    };
  } else {
    // regex on ISO date for any other field
    query = {
      [field]: { $regex: `^${todayIso}` },
      cc:      { $regex: ccVal,   $options: 'i' }
    };
  }
      } else {
        query = { "Date of Interview": todayStr };
      }
      const docs = await taskBodyCollection.find(query).toArray();
      console.log(query);
      const lowerEmail = authUser.email.toLowerCase();
      let teamEmails = [];
      const fullName = 'Not Assigned';
      if (authUser.role === "lead") {
        const [first, last] = lowerEmail.split("@")[0].split(".");
        const fullName =
          `${first[0].toUpperCase()}${first.slice(1)} ` +
          `${last[0].toUpperCase()}${last.slice(1)}`;
        teamEmails = Object.entries(users)
          .filter(
            ([mail, u]) =>
              u.teamLead === fullName || mail.toLowerCase() === lowerEmail,
          )
          .map(([e]) => e.toLowerCase());
      }
      
      console.log(teamEmails);
      const tasks = [];
      
      console.log(`Starting to process ${docs.length} docs for user ${authUser.email}`);
      
      // normalize once
      const userEmailLower = authUser.email.toLowerCase();
      
      for (const doc of docs) {
        // 1) Log which raw document we’re looking at
        console.log(`\n[doc] id=${doc._id || doc.id || '(no-id)'} raw=`, doc['Candidate Name']);
      
        // 2) Attempt to format
        const task = formatTask(doc);
        if (!task) {
          console.log(
            `[skip] formatTask returned null/undefined for doc id=${doc._id || '(no-id)'}`
          );
          continue;
        }
        if (authUser.role === "MAM" || authUser.role === "MM") {
          const localPart = doc.sender.toLowerCase().split("@")[0];
          const parts = localPart.split(".");

          let recruiterName;
          if (parts.length >= 2) {
            const [first, last] = parts;
            recruiterName =
              `${first[0].toUpperCase()}${first.slice(1)} ` +
              `${last[0].toUpperCase()}${last.slice(1)}`;
          } else {
            const only = parts[0];
            recruiterName = `${only[0].toUpperCase()}${only.slice(1)}`;
          }

          tasks.push({
            ...task,
            recruiterName
          });
          continue;
        }        
        console.log(
          `[formatted] taskId=${task._id} assignedEmail=${task.assignedEmail}`
        );
      
        // 3) Compute permission
        const assignedEmailLower = task.assignedEmail?.toLowerCase() || '';
        
        const isAdmin = authUser.role === 'admin';
        const isSelf = userEmailLower === assignedEmailLower;
        const isOnTeam = teamEmails.includes(assignedEmailLower);
      
        console.log(
          `[check] role=${authUser.role} isAdmin=${isAdmin} isSelf=${isSelf} isOnTeam=${isOnTeam}`
        );
      
        const allowed = isAdmin || isSelf || isOnTeam;
        if (!allowed) {
          console.log(
            `[skip] user not allowed to see task ${task._id} (assigned to ${assignedEmailLower})`
          );
          continue;
        }
      
        // 4) All good → push
        tasks.push(task);
        console.log(`[push] task ${task._id} added (total so far: ${tasks.length})`);
      }
      
      console.log(`Done processing docs — final task count: ${tasks.length}`);


      // **Sort once, outside the loop**:
      //  - by startTime ascending
      //  - tie-break by endTime ascending
      tasks.sort((a, b) => {
        const diff = a.startTime - b.startTime;
        if (diff !== 0) return diff;
        return a.endTime - b.endTime;
      });
      console.log(
        `[getTasksToday] returning ${tasks.length} tasks to ${authUser.email}`,
      );
      callback({ success: true, tasks });
    } catch (err) {
      console.log(err.message);
    }
  });

  socket.on("disconnect", (reason) =>
    console.log(`❌ Socket disconnected [id=${socket.id}] reason: ${reason}`),
  );
});

// --- Start Server ---
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
