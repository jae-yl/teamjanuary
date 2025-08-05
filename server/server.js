// server/server.js
import express from 'express';
import session from 'express-session';
import env from '../env.json' with { type: 'json' };
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import * as argon2 from 'argon2';

import { Pool } from 'pg';
let pool = new Pool({connectionString: process.env.DATABASE_URL});

const app = express();
app.use(express.static("src"));
app.use(express.json());

// sessions (cookies) middleware
app.use(session({
    secret: env.SESSION_SECRET,
    resave: false, // Prevents unnecessary session saves if the session wasn't modified
    saveUninitialized: false, // Prevents a session from being created for anonymous users
    cookie: {
        httpOnly: true, // Prevents client-side JavaScript from accessing the cookie
        secure: false, // In production, this should be true and your server should be on HTTPS
        maxAge: 1000 * 60 * 60 * 12 // Cookie will expire in 12 hours
    }
}));

app.post("/signup", async (req, res) => {
  try {
    let body = req.body;

    if (!body.hasOwnProperty("username") || !body.hasOwnProperty("password")) {
      throw new Error("Username and password are required");
    }

    // Check if the username is valid (doesn't exist already)
    let existingUser = await pool.query("SELECT * FROM ud WHERE username = $1;", [body['username']]);

    if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: "Username already exists" });
    }

    let hashedPassword = await argon2.hash(body['password']);
    console.log(hashedPassword);
    // Insert the new user into the database
    //await pool.query("INSERT INTO ud (username, pwd) VALUES ($1, $2);", [body['username'], hashedPassword]);

    return res.status(200).json({});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    let body = req.query;

    if (!body.hasOwnProperty("username") || !body.hasOwnProperty("password")) {
      throw new Error("Username and password are required");
    }

    // Check if the username exists
    let user = await pool.query("SELECT * FROM ud WHERE username = $1;", [body['username']]);

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Username does not exist" });
    }

    // Verify the password
    let isValidPassword = await argon2.verify(user.rows[0].pwd, body['password']);

    if (!isValidPassword) {
      return res.status(400).json({ error: "Invalid password" });
    }

    // Set session user
    req.session.user = {
      id: body['username']
    };

    return res.status(200).json({});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// TODO: Implement login and signup routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/src/pages/dashboard/index.html');
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send_message", (data) => {
    socket.broadcast.emit("receive_message", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
