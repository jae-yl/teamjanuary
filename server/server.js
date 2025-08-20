// server/server.js
import express from 'express';
import session from 'express-session';
import env from '../env.json' with { type: 'json' };
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import * as argon2 from 'argon2';

import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

import connectPgSimple from 'connect-pg-simple';
const pgSession = connectPgSimple(session);

const app = express();
app.use(express.static("src"));

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

app.use(express.json());

app.listen(3000, '127.0.0.1', () => {
  console.log('Server is running on http://127.0.0.1:3000');
});

// ──────────────── ROUTES ────────────────

app.post("/login", async (req, res) => {
  try {
    const { display_name, email, id } = req.body;
    if (!display_name || !email || !id) throw new Error("display_name, email, id not found");

    const result = await pool.query("SELECT * FROM ud WHERE id = $1", [id]);
    // create account if does not exist
    if (result.rows.length === 0) {
      pool.query("INSERT INTO ud (id, display_name, email) VALUES ($1, $2, $3)", [id, display_name, email]);
    }

    req.session.user = { id: id, display_name: display_name, email: email };
    req.session.save(err => {
      if (err) return res.status(500).json({ error: "Could not save session" });
      return res.status(200).json({});
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

  socket.on("join_room", (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room}`);
  });

  socket.on("send_message", (data) => {
    const { room, user, msg } = data;
    if (!room || !user || !msg) return;

    io.to(room).emit("receive_message", { user, msg });
    console.log(`[Room ${room}] ${user}: ${msg}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ──────────────── SERVER ────────────────

server.listen(3001, '127.0.0.1', () => {
  console.log("Socket server running at http://127.0.0.1:3000");
});
