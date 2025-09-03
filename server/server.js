// server/server.js
import express from 'express';
import session from 'express-session';
import env from '../env.json' with { type: 'json' };
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// connect to db
pool.query('SELECT current_database() AS db, current_user AS usr')
.then(r => console.log('PG connected →', r.rows[0]))
.catch(e => console.error('PG connect check failed:', e));


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
    const { display_name, email, id, user_pfp } = req.body;
    if (!display_name || !email || !id ) {
      throw new Error("display_name, or email not found");
    }

    await pool.query(
      "INSERT INTO ud (id, display_name, email) VALUES ($1, $2, $3, $4);",
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

    // fetch user data
    const accountData = await pool
      .query("SELECT * FROM ud WHERE id = $1;", [id])
      .then(r => r.rows[0]);

    if (!accountData) {
      return res.status(404).json({ error: "Account not found" });
    }

    // if our stored pfp is different from the one recieved, update it
    if (user_pfp != accountData.user_pfp) {
      await pool.query("UPDATE ud SET pfp_link = $1 WHERE id = $2;", [user_pfp, id]);
    }

    req.session.user = {
      id: accountData.id,
      display_name: accountData.display_name,
      email: accountData.email,
      user_pfp: user_pfp ?? null
    };

    // fetch user chat rooms
    const userChatRooms = await pool
    .query("select cr.chat_room_id, cr.room_member_id, ud.display_name, ud.pfp_link from (select * from chat_rooms where room_member_id = $1) as td\
      join chat_rooms as cr ON cr.chat_room_id = td.chat_room_id\
      join ud ON ud.id = cr.room_member_id\
      where cr.room_member_id != $2;", [accountData.id, accountData.id])
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
  cors: {
    origin: ["http://127.0.0.1:5173", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"]
  }
});

async function joinRoom(socket, userId, room) {
  if (room === null) return;

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

var userSocketMap = new Map();
var userPFPMap = new Map();
var userDisplayMap = new Map();
var userPreferenceMap = new Map();
var userExistingChats = new Map(); // holds userid: [ user ids already connected ]
io.on("connection", (socket) => {
  const { userId, existingChats, userPfp, userDisplay } = socket.handshake.query;
  console.log("User connected:", userId);
  userSocketMap.set(userId, socket);
  userPFPMap.set(userId, userPfp);
  userDisplayMap.set(userId, userDisplay);
  userExistingChats.set(userId, new Set(JSON.parse(existingChats)));

  socket.on("search_for_room", async (artists) => {
    userPreferenceMap.delete(userId); // just for edge case they are already somehow searching

    // first we check if their preferences match someone searching
    for (const [id, prefs] of userPreferenceMap) {
      // contains a match
      if (artists.some(item => prefs.has(item))) {
        // chat room does not already exist between the 2 people
        if (!userExistingChats.get(userId).has(id)) {
          console.log(userId, "matched with", id);
          userExistingChats.get(userId).add(id);
          // remove from search if found
          userPreferenceMap.delete(id);

          // create them a room and have both of them join
          try {
            const newRoomId = await pool.query('SELECT COALESCE(MAX(chat_room_id), 0) + 1 as newid FROM chat_rooms;').then(r => { return r.rows[0]['newid'] });
            await pool.query('INSERT INTO chat_rooms (chat_room_id, room_member_id) VALUES ($1, $2), ($3, $4)',
              [newRoomId, id, newRoomId, userId]
            );

            console.log('trying to join room');

            joinRoom(userSocketMap.get(userId), userId, newRoomId);
            joinRoom(userSocketMap.get(id), id, newRoomId);

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
            console.log("error trying to create new room");
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

  // JOIN: load last 50 messages (oldest → newest) for this room
  socket.on("join_room", async (room) => {
    await joinRoom(socket, userId, room);
  });

  // SEND: persist message and broadcast to everyone in the room EXCEPT the sender
  socket.on("send_message", async (data = {}) => {
    const { room, user, msg } = data;
    if (room === null || !user || !msg) return;

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
    console.log("User disconnected:", userId);
    userPreferenceMap.delete(userId);
    userExistingChats.delete(userId);
  });
});

// ──────────────── SERVER ────────────────

server.listen(3001, '127.0.0.1', () => {
  console.log("Socket server running at http://127.0.0.1:3001");
});

