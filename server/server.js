// server/server.js
import express from 'express';
import session from 'express-session';
import env from '../env.json' with { type: 'json' };
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query('SELECT current_database() AS db, current_user AS usr')
  .then(r => console.log('PG connected →', r.rows[0]))
  .catch(e => console.error('PG connect check failed:', e));

// ──────────────── CHATS TABLE BOOTSTRAP (Option A schema) ────────────────
async function ensureChatsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.chats (
      id          SERIAL PRIMARY KEY,
      room        VARCHAR(50) NOT NULL,
      username    VARCHAR(50) NOT NULL,
      message     TEXT        NOT NULL,
      "timestamp" TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sender_id   VARCHAR
    );
    CREATE INDEX IF NOT EXISTS idx_chats_room_ts   ON public.chats (room, "timestamp");
    CREATE INDEX IF NOT EXISTS idx_chats_sender_id ON public.chats (sender_id);
  `);
}
ensureChatsTable().catch(err => {
  console.error("Failed to ensure chats table:", err);
  process.exit(1);
});



import connectPgSimple from 'connect-pg-simple';
const pgSession = connectPgSimple(session);

const app = express();
app.use(express.static("src"));
app.use(express.json());

// Allow cross-origin requests for front-end dev
app.use(cors({
  origin: ["http://127.0.0.1:5173"],
  methods: ["GET", "POST"],
  credentials: true
}));

// Session middleware
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.listen(3000, '127.0.0.1', () => {
  console.log('Server is running on http://127.0.0.1:3000');
});

// ──────────────── ROUTES ────────────────

app.post("/verifyaccount", async (req, res) => {
  try {
    const { id } = req.body;

    const userExists = await pool.query("SELECT * FROM ud WHERE id = $1;", [id]);

    return res.status(200).json({ exists: userExists.rows.length > 0 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/createaccount", async (req, res) => {
  try {
    const { display_name, email, id } = req.body;
    if (!display_name || !email || !id ) {
      throw new Error("display_name, or email not found");
    }

    await pool.query(
      "INSERT INTO ud (id, display_name, email) VALUES ($1, $2, $3);",
      [id, display_name, email]
    );

    return res.status(200).json({ status: "ok" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) throw new Error("id not found");

    // fetch user data
    const accountData = await pool
      .query("SELECT * FROM ud WHERE id = $1;", [id])
      .then(r => r.rows[0]);

    if (!accountData) {
      return res.status(404).json({ error: "Account not found" });
    }

    req.session.user = {
      id: accountData.id,
      display_name: accountData.display_name,
      email: accountData.email,
    };

    // fetch user chats
    const userChats = await pool
    .query("select cr.chat_room_id, cr.room_member_id, ud.display_name from (select * from chat_rooms where room_member_id = $1) as td\
      join chat_rooms as cr ON cr.chat_room_id = td.chat_room_id\
      join ud ON ud.id = cr.room_member_id\
      where cr.room_member_id != $2;", [accountData.id, accountData.id])
    .then(r => r.rows);

    req.session.chats = userChats;

    req.session.save(err => {
      if (err) return res.status(500).json({ error: "Could not save session" });
      return res.status(200).json({ chats: userChats });
    });
  } catch (e) {
    return res.status(400).json({ error: e.message, where: 'post' });
  }
});

app.post("/logout", (req, res) => {
  try {
    req.session.destroy(err => {
      if (err) return res.status(500).json({ error: "Could not log out" });
      return res.status(200).json({ message: "Logged out successfully" });
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/findmatch", (req, res) => {
  const { titles, artists, albums } = req.body;

  console.log('titles:', titles);
  console.log('artists:', artists);
  console.log('albums:', albums);

  try {
    console.log("Session data:", req.session);
    res.status(200).json({ status: "ok" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ──────────────── SOCKET.IO ────────────────

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://127.0.0.1:5173", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // JOIN: load last 50 messages (oldest → newest) for this room
  socket.on("join_room", async (room) => {
    if (room === null) return;
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room}`);

    try {
      const { rows } = await pool.query(
        `SELECT username, message, sender_id, "timestamp"
         FROM public.chats
         WHERE room = $1
         ORDER BY "timestamp" ASC
         LIMIT 50`,
        [room]
      );
      // only to the joining user
      socket.emit("load_messages", rows);
    } catch (err) {
      console.error("Error fetching chat history:", err);
      socket.emit("room_history_error", "Could not load chat history");
    }
  });

  // SEND: persist message and broadcast to everyone in the room EXCEPT the sender
socket.on("send_message", async (data = {}) => {
  const { room, user, msg } = data;
  if (!room || !user || !msg) return;

  const username  = typeof user === "string" ? user : (user?.username || String(user?.id) || "user");
  const sender_id = typeof user === "string" ? null : (user?.id != null ? String(user.id) : null);

  console.log("SEND_MESSAGE received →", { room, username, msg });

  try {
    const result = await pool.query(
      `INSERT INTO public.chats (room, username, message, sender_id)
       VALUES ($1, $2, $3, $4)`,
      [room, username, msg, sender_id]
    );
    console.log("INSERT rowCount →", result.rowCount);

    // send to everyone else (prevents double bubble for sender)
// send to everyone else (prevents double bubble for sender)
socket.to(room).emit("receive_message", {
  room,
  username,                 // new shape
  user: username,           // legacy shape
  message: msg,             // new shape
  msg,                      // legacy shape
  sender_id,
  timestamp: new Date().toISOString(),
});

  } catch (err) {
    console.error("INSERT error →", err);
    socket.emit("send_error", "Could not send your message");
  }
});

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ──────────────── SERVER ────────────────

server.listen(3001, '127.0.0.1', () => {
  console.log("Socket server running at http://127.0.0.1:3001");
});

