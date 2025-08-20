import { io } from "socket.io-client";

const socket = io("http://localhost:3000")

// DOM refs
const messagesEl = document.querySelector(".main-chat-window .chat__messages");
const inputEl = document.querySelector(".main-chat-window .chat__input");
const sendBtn = document.querySelector(".main-chat-window .chat__send");
const titleEl = document.querySelector(".main-chat-window .chat__title");
const roomCards = Array.from(
  document.querySelectorAll(".chat-rooms .chat-room-card")
);

let username = localStorage.getItem("vm_username") || "";
if (!username) {
  const ask = (window.prompt("Enter a display name:") || "").trim();
  username = ask || `User-${Math.floor(Math.random() * 999)}`;
  localStorage.setItem("vm_username", username);
}

let currentRoom = null;

function normalizeRoomName(card, index) {
  // Use data-room if present, else slugify text, else fallback to roomN
  const dataset = card.getAttribute("data-room");
  if (dataset) return dataset;
  const text = (card.textContent || "").trim().toLowerCase();
  if (text) return text.replace(/\s+/g, "-");
  return `room${index + 1}`;
}

function setActiveRoomCard(activeCard) {
  roomCards.forEach((c) => c.classList.toggle("active", c === activeCard));
}

function clearMessages() {
  if (messagesEl) messagesEl.innerHTML = "";
}

function joinRoom(room, cardEl) {
  if (!room) return;
  if (currentRoom) socket.emit("leave_room", currentRoom);
  currentRoom = room;
  socket.emit("join_room", currentRoom);
  clearMessages();
  if (titleEl) titleEl.textContent = `Chat Window — ${currentRoom}`;
  if (cardEl) setActiveRoomCard(cardEl);
}

roomCards.forEach((card, i) => {
  const roomName = normalizeRoomName(card, i);
  card.addEventListener("click", () => joinRoom(roomName, card));
});

if (!currentRoom && roomCards.length) {
  const first = roomCards[0];
  joinRoom(normalizeRoomName(first, 0), first);
}

function timeNow(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addMessage({ text, who = "them", user, timestamp = Date.now() }) {
  if (!text) return;

  const wrap = document.createElement("div");
  wrap.className = `msg ${who === "me" ? "msg--me" : "msg--them"}`;

  const bubble = document.createElement("div");
  bubble.className = "msg__bubble";
  bubble.textContent = text;

  const meta = document.createElement("span");
  meta.className = "msg__meta";
  meta.textContent = `${who === "me" ? "You" : (user || "User")} • ${timeNow(timestamp)}`;

  wrap.append(bubble, meta);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- Send message ----
function sendMessage() {
  const text = (inputEl?.value || "").trim();
  if (!text) return;

  addMessage({ text, who: "me", user: username });

  if (socket && currentRoom) {
    socket.emit("send_message", { room: currentRoom, user: username, msg: text, timestamp: Date.now() });
  }

  inputEl.value = "";
}

sendBtn?.addEventListener("click", sendMessage);
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

socket.off("receive_message");
socket.on("receive_message", (data) => {
  if (data.room !== currentRoom) return;
  const isMe = data.user === username;
  if (!isMe) {
    addMessage({
      text: data.msg,
      who: "them",
      user: data.user,
      timestamp: data.timestamp || Date.now(),
    });
  }
});

// ========== Logout ==========
document.getElementById("profile-pic-banner")?.addEventListener("click", () => {
  fetch('http://localhost:3000/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(res => {
    if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
    return res.json();
  }).then(() => {
    window.location.href = "./index.html?m=lO";
  }).catch(console.error);
});

// ========== Find Match ==========
document.getElementById('findMatchButton')?.addEventListener('click', () => {
  fetch('http://localhost:3000/findmatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(res => {
    if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
    return res.json();
  }).then(data => {
    console.log("Match found:", data);
  }).catch(console.error);
});
