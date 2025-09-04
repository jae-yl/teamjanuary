// server/server.js
import express from 'express';
import session from 'express-session';
import env from '../env.json' with { type: 'json' };
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

import connectPgSimple from 'connect-pg-simple';
const pgSession = connectPgSimple(session);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

const ORIGIN_DEV  = 'http://localhost:5173';
const ORIGIN_PROD = process.env.PUBLIC_ORIGIN || 'https://vibematch.fly.dev';
const ALLOWED_ORIGINS = isProd ? [ORIGIN_PROD] : [ORIGIN_DEV];

const app = express();

if (isProd) app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.json());

// CORS
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST"],
  credentials: true
}));

// Sessions
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

// ──────────────── ROUTES ────────────────

app.post("/verifyaccount", async (req, res) => {
  try {
    const { id } = req.body;
    const userExists = await pool.query("SELECT 1 FROM ud WHERE id = $1;", [id]);
    return res.status(200).json({ exists: userExists.rows.length > 0 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/createaccount", async (req, res) => {
  try {
    const { display_name, email, id, user_pfp } = req.body;
    if (!display_name || !email || !id) throw new Error("display_name or email not found");

    await pool.query(
      "INSERT INTO ud (id, display_name, email, pfp_link) VALUES ($1, $2, $3, $4);",
      [id, display_name, email, user_pfp ?? 'n']
    );

    return res.status(200).json({ status: "ok" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { id, user_pfp } = req.body;
    if (!id) throw new Error("id not found");

    const accountData = await pool
      .query("SELECT * FROM ud WHERE id = $1;", [id])
      .then(r => r.rows[0]);

    if (!accountData) return res.status(404).json({ error: "Account not found" });

    if (user_pfp && user_pfp !== accountData.pfp_link) {
      await pool.query("UPDATE ud SET pfp_link = $1 WHERE id = $2;", [user_pfp, id]);
    }

    req.session.user = {
      id: accountData.id,
      display_name: accountData.display_name,
      email: accountData.email,
      user_pfp: user_pfp ?? accountData.pfp_link ?? null
    };

    // user chat rooms (other member + their pfp)
    const userChatRooms = await pool
      .query(
        `select cr.chat_room_id, cr.room_member_id, ud.display_name, ud.pfp_link
         from (select * from chat_rooms where room_member_id = $1) as td
         join chat_rooms as cr ON cr.chat_room_id = td.chat_room_id
         join ud ON ud.id = cr.room_member_id
         where cr.room_member_id != $2;`,
        [accountData.id, accountData.id]
      )
      .then(r => r.rows);

    req.session.chatRooms = userChatRooms;

    req.session.save(err => {
      if (err) return res.status(500).json({ error: "Could not save session" });
      return res.status(200).json({ chats: userChatRooms });
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
    const { artists } = req.body;
    if (!artists) throw new Error("artists not found");
    console.log("Session data:", req.session);
    res.status(200).json({ status: "ok" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ──────────────── SOCKET.IO ────────────────

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// helper: join + load history
async function joinRoom(socket, userId, room) {
  if (room == null) return;

  socket.join(room);
  console.log(`Socket ${userId} joined room ${room}`);

  try {
    const { rows } = await pool.query(
      `SELECT username, message, sender_id, "timestamp"
       FROM chats
       WHERE room = $1
       ORDER BY "timestamp" ASC
       LIMIT 50`,
      [room]
    );
    socket.emit("load_messages", rows);
  } catch (err) {
    console.error("Error fetching chat history:", err);
    socket.emit("room_history_error", "Could not load chat history");
  }
}

// state
const userSocketMap = new Map();
const userPFPMap = new Map();
const userDisplayMap = new Map();
const userPreferenceMap = new Map();
const userExistingChats = new Map(); // userId -> Set of userIds already connected

const collaborativePlaylists = {}; // { [roomId]: { playlistId, playlistName, playlistUrl, songs: [] } }

io.on("connection", (socket) => {
  const { userId, existingChats, userPfp, userDisplay } = socket.handshake.query;
  console.log("User connected:", userId);

  userSocketMap.set(userId, socket);
  userPFPMap.set(userId, userPfp);
  userDisplayMap.set(userId, userDisplay);

  // parse existing chats safely
  let parsed = [];
  try { parsed = JSON.parse(existingChats || "[]"); } catch {}
  userExistingChats.set(userId, new Set(parsed));

  // matching by artists
  socket.on("search_for_room", async (artists = []) => {
    userPreferenceMap.delete(userId); // reset any prior search

    for (const [id, prefs] of userPreferenceMap) {
      if (artists.some(a => prefs.has(a))) {
        if (!userExistingChats.get(userId)?.has(id)) {
          console.log(userId, "matched with", id);
          userExistingChats.get(userId).add(id);
          userExistingChats.get(id).add(userId);
          
          userPreferenceMap.delete(id);

          try {
            const newRoomId = await pool
              .query('SELECT COALESCE(MAX(chat_room_id), 0) + 1 as newid FROM chat_rooms;')
              .then(r => r.rows[0]['newid']);

            await pool.query(
              'INSERT INTO chat_rooms (chat_room_id, room_member_id) VALUES ($1, $2), ($1, $3)',
              [newRoomId, id, userId]
            );

            await joinRoom(userSocketMap.get(userId), userId, newRoomId);
            await joinRoom(userSocketMap.get(id), id, newRoomId);

            io.to(newRoomId).emit('matched_room', {
              room_id: newRoomId,
              user1: userId,
              user2: id,
              user1pfp: userPFPMap.get(userId),
              user2pfp: userPFPMap.get(id),
              user1display: userDisplayMap.get(userId),
              user2display: userDisplayMap.get(id)
            });
          } catch (e) {
            console.log("error trying to create new room:", e);
          }
          return;
        } else {
          console.log('chat between', userId, "and", id, "already exists");
        }
      }
    }

    console.log('added to search list', userId);
    userPreferenceMap.set(userId, new Set(artists));
  });

  socket.on("stop_searching", () => {
    console.log('removed from search list', userId);
    userPreferenceMap.delete(userId);
  });

  // join room
  socket.on("join_room", async (room) => {
    await joinRoom(socket, userId, room);
  });

  // send message
  socket.on("send_message", async (data = {}) => {
    const { room, user, msg } = data;
    if (room == null || !user || !msg) return;

    const username  = typeof user === "string" ? user : (user?.username || String(user?.id) || "user");
    const sender_id = typeof user === "string" ? null : (user?.id != null ? String(user.id) : null);

    try {
      await pool.query(
        `INSERT INTO chats (room, username, message, sender_id)
         VALUES ($1, $2, $3, $4)`,
        [room, username, msg, sender_id]
      );

      socket.to(room).emit("receive_message", {
        room,
        username,
        user: username,
        message: msg,
        msg,
        sender_id,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("INSERT error →", err);
      socket.emit("send_error", "Could not send your message");
    }
  });

  // ── Collaborative playlist events ──

  socket.on("create_collab_playlist", (data = {}) => {
    const { room, playlistId, playlistName, playlistUrl } = data;
    if (!room || !playlistId) return;

    collaborativePlaylists[room] = {
      playlistId,
      playlistName,
      playlistUrl,
      songs: []
    };

    io.to(room).emit("collab_playlist_created", {
      room,
      playlistId,
      playlistName,
      playlistUrl
    });
  });

  socket.on("add_song", (data = {}) => {
    const { room, songName, user } = data;
    if (!room || !songName) return;

    if (!collaborativePlaylists[room]) {
      collaborativePlaylists[room] = { songs: [] };
    }
    collaborativePlaylists[room].songs ||= [];
    collaborativePlaylists[room].songs.push(songName);

    io.to(room).emit("song_added", { room, songName, user });
  });

  socket.on("request_collab_state", (data = {}) => {
    const { room } = data;
    if (!room) return;

    const state = collaborativePlaylists[room] || {};
    socket.emit("collab_state", {
      room,
      playlistId: state.playlistId,
      playlistName: state.playlistName,
      playlistUrl: state.playlistUrl,
      songs: state.songs || []
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", userId);
    userPreferenceMap.delete(userId);
    userExistingChats.delete(userId);
    userSocketMap.delete(userId);
    userPFPMap.delete(userId);
    userDisplayMap.delete(userId);
  });
});

// ──────────────── SERVER (sockets) ────────────────
/*server.listen(3001, '0.0.0.0', () => {
  console.log("Socket server running at http://0.0.0.0:3001");
});*/

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

