// server/server.js
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';


import { Client } from 'pg';
const client = new Client({connectionString: process.env.DATABASE_URL})

await client.connect()
const res = await client.query('SELECT * FROM ud')
console.log(res.rows[0])
await client.end()


const app = express();
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
