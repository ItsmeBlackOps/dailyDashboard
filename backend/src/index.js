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
const mongoURI = MONGODB_URI;
const PORT = process.env.PORT || 3004;

// --- Globals ---
let db;
let taskBodyCollection;
const users = new Map();
const refreshTokens = new Map();

// --- Helpers ---
async function loadUsers() {
  const all = await db.collection("users").find().toArray();
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

function getUserByEmail(email) {
  return users.get(email.toLowerCase()) || null;
}

function formatTask(doc) {
  const dateStr  = doc["Date of Interview"];
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

  if (!startMoment.isValid() || !endMoment.isValid()) {
    console.log("Invalid interview times, skipping task", doc._id);
    return null;
  }

  let assignedExpert = "Not Assigned";
  let assignedEmail  = null;
  let assignedAt     = null;

  if (Array.isArray(doc.replies)) {
    const assignments = doc.replies
      .map(r => {
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
      const latest = assignments.reduce((a, b) =>
        b.ts.isAfter(a.ts) ? b : a
      );
      assignedEmail = latest.email;
      assignedAt    = latest.ts.toISOString();

      assignedExpert = assignedEmail
        .split("@")[0]
        .split(".")
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
    }
  }

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
    const fullName = `${first[0].toUpperCase()}${first.slice(1)} ` +
                     `${last[0].toUpperCase()}${last.slice(1)}`;

    for (const [mail, u] of users.entries()) {
      if (u.teamLead === fullName || mail === lowerEmail) {
        teamEmails.push(mail);
      }
    }
  }

  return (
    user.role === "admin" ||
    lowerEmail === assignedEmail?.toLowerCase() ||
    teamEmails.includes(assignedEmail?.toLowerCase())
  );
}

function emitToRelevant(event, task) {
  for (const socket of io.of("/").sockets.values()) {
    const user = socket.data.user;
    if (user && shouldSendTask(user, task.assignedEmail)) {
      socket.emit(event, task);
    }
  }
}

// --- Mongo Connection & Watchers ---
async function connectMongo() {
  console.log("🚀 Connecting to MongoDB...");
  const client = new MongoClient(mongoURI);
  await client.connect();

  db = client.db("interviewSupport");
  taskBodyCollection = db.collection("taskBody");
  console.log("✅ Connected to MongoDB");

  // Initial load of users
  await loadUsers();

  // Watch users collection for cache updates
  const usersStream = db.collection("users").watch();
  usersStream.on("change", async change => {
    if (change.operationType === "delete") {
      await loadUsers();
    } else {
      const doc = change.fullDocument
        ?? await db.collection("users")
             .findOne({ _id: change.documentKey._id });
      users.set(doc.email.toLowerCase(), {
        passwordHash: doc.passwordHash,
        role:         doc.role,
        teamLead:     doc.teamLead,
        manager:      doc.manager,
      });
      console.log(`🔄 User cache upserted: ${doc.email}`);
    }
  });

  // Watch taskBody for real-time emits
  const changeStream = taskBodyCollection.watch([
    { $match: { operationType: { $in: ["insert", "update"] } } }
  ]);

  changeStream.on("change", async change => {
    try {
      const doc = change.operationType === "insert"
        ? change.fullDocument
        : await taskBodyCollection.findOne({ _id: change.documentKey._id });

      const formatted = formatTask(doc);
      if (!formatted) return;

      const event = change.operationType === "insert"
        ? "taskCreated"
        : "taskUpdated";

      console.log(`[changeStream] ${event} for ${formatted.assignedEmail}`);
      emitToRelevant(event, formatted);
    } catch (err) {
      console.error("Change stream processing error:", err);
    }
  });

  changeStream.on("error", err =>
    console.error("Change stream error:", err)
  );
}

// --- App & Socket.IO Setup in Async IIFE ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();

  try {
    const { email } = jwt.verify(token, JWT_SECRET);
    const user = getUserByEmail(email);
    if (!user) throw new Error("Unauthorized");

    socket.data.user = {
      email,
      role:     user.role,
      teamLead: user.teamLead,
      manager:  user.manager,
    };
    console.log(`[Auth] Socket authenticated: ${email}`);
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", socket => {
  console.log(`🔌 Socket connected [id=${socket.id}]`);

  socket.on("login", ({ email, password }, cb) => {
    try {
      const user = getUserByEmail(email);
      if (!user) throw new Error("Invalid credentials");

      const hash = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");

      if (hash !== user.passwordHash) {
        throw new Error("Invalid credentials");
      }

      const accessToken  = jwt.sign({ email }, JWT_SECRET, { expiresIn: "15m" });
      const refreshToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
      refreshTokens.set(refreshToken, email);

      socket.data.user = { email, role: user.role, teamLead: user.teamLead, manager: user.manager };
      console.log(`[Auth] ${email} logged in via socket`);

      cb({
        success: true,
        accessToken,
        refreshToken,
        role:     user.role,
        teamLead: user.teamLead,
        manager:  user.manager,
      });
    } catch (err) {
      cb({ success: false, error: err.message });
    }
  });

  socket.on("refresh", ({ refreshToken }, cb) => {
    if (!refreshToken || !refreshTokens.has(refreshToken)) {
      return cb({ success: false, error: "Invalid refresh token" });
    }
    try {
      const { email } = jwt.verify(refreshToken, JWT_SECRET);
      const accessToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: "15m" });
      cb({ success: true, accessToken });
    } catch {
      cb({ success: false, error: "Invalid refresh token" });
    }
  });

  socket.on("getTasksToday", async ({ tab }, cb) => {
    const authUser = socket.data.user;
    if (!authUser) return cb({ success: false, error: "Unauthorized" });

    try {
      const todayStr = moment.tz("America/New_York").format("MM/DD/YYYY");
      const todayIso = moment.tz("America/New_York").format("YYYY-MM-DD");

      let query;
      if (["MAM","MM"].includes(authUser.role)) {
        const mngr  = authUser.manager.toLowerCase().split(" ").join(".");
        const ccVal = authUser.role === "MM"
          ? authUser.email.split("@")[0]
          : mngr;

        if (tab === "Date of Interview") {
          query = { [tab]: todayStr, cc: { $regex: ccVal, $options: "i" } };
        } else {
          query = { [tab]: { $regex: `^${todayIso}` }, cc: { $regex: ccVal, $options: "i" } };
        }
      } else {
        query = { "Date of Interview": todayStr };
      }

      const docs = await taskBodyCollection.find(query).toArray();
      const userEmailLower = authUser.email.toLowerCase();
      let teamEmails = [];

      if (authUser.role === "lead") {
        const [first, last] = userEmailLower.split("@")[0].split(".");
        const fullName = `${first[0].toUpperCase()}${first.slice(1)} ` +
                         `${last[0].toUpperCase()}${last.slice(1)}`;

        for (const [mail,u] of users.entries()) {
          if (u.teamLead === fullName || mail === userEmailLower) {
            teamEmails.push(mail);
          }
        }
      }

      const tasks = [];
      for (const doc of docs) {
        const task = formatTask(doc);
        if (!task) continue;

        if (["MAM","MM"].includes(authUser.role)) {
          const localPart = doc.sender.toLowerCase().split("@")[0];
          const parts = localPart.split(".");
          const recruiterName = parts.length >= 2
            ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)} ` +
              `${parts[1][0].toUpperCase()}${parts[1].slice(1)}`
            : `${parts[0][0].toUpperCase()}${parts[0].slice(1)}`;

          tasks.push({ ...task, recruiterName });
          continue;
        }

        const assignedEmailLower = task.assignedEmail?.toLowerCase() || "";
        const allowed = (
          authUser.role === "admin" ||
          userEmailLower === assignedEmailLower ||
          teamEmails.includes(assignedEmailLower)
        );
        if (allowed) tasks.push(task);
      }

      tasks.sort((a,b) => {
        const diff = a.startTime - b.startTime;
        return diff !== 0 ? diff : a.endTime - b.endTime;
      });

      cb({ success: true, tasks });
    } catch (err) {
      console.error(err);
      cb({ success: false, error: err.message });
    }
  });

  socket.on("disconnect", reason =>
    console.log(`❌ Socket disconnected [id=${socket.id}] reason: ${reason}`)
  );
});

// --- Start Everything ---
(async () => {
  await connectMongo();
  server.listen(PORT, () =>
    console.log(`🚀 Server listening on port ${PORT}`)
  );
})();
