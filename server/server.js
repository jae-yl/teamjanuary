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
  origin: ["http://localhost:5173"],
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

// ──────────────── ROUTES ────────────────

app.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) throw new Error("Username and password are required");

    const userCheck = await pool.query("SELECT * FROM ud WHERE username = $1", [username]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists", where: 'username' });
    }

    const hashedPassword = await argon2.hash(password);
    await pool.query("INSERT INTO ud (username, pwd) VALUES ($1, $2)", [username, hashedPassword]);

    req.session.user = { id: username };
    req.session.save(err => {
      if (err) return res.status(500).json({ error: "Could not save session" });
      return res.status(200).json({});
    });

  } catch (e) {
    return res.status(400).json({ error: e.message, where: 'post' });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) throw new Error("Username and password are required");

    const result = await pool.query("SELECT * FROM ud WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Username does not exist", where: 'username' });
    }

    const user = result.rows[0];
    const isValid = await argon2.verify(user.pwd, password);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid password", where: 'password' });
    }

    req.session.user = { id: username };
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
    origin: ["http://localhost:5173", "http://localhost:3000"],
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

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
