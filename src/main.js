import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

const chatContainer = document.createElement("div");
chatContainer.classList.add("p-2");
chatContainer.innerHTML = `
  <h5>Chat</h5>
  <input type="text" id="username" placeholder="Your name" class="form-control mb-2" />
  <input type="text" id="messageInput" placeholder="Your message..." class="form-control mb-2" />
  <button class="btn btn-primary mb-3" id="sendBtn">Send</button>
  <div id="chat-messages" style="max-height: 300px; overflow-y: auto;"></div>
`;
const chatWindowBody = document.querySelector("#chat-window-column .card-body");
chatWindowBody?.appendChild(chatContainer);

// ========== Room Switching ==========
let currentRoom = null;
document.querySelectorAll("#chat-list-column .card").forEach((card, i) => {
  card.addEventListener("click", () => {
    const newRoom = `room${i + 1}`;
    if (newRoom === currentRoom) return;
    if (currentRoom) socket.emit("leave_room", currentRoom);
    currentRoom = newRoom;
    socket.emit("join_room", currentRoom);
    clearMessages();
    const title = document.querySelector("#chat-window-column h1");
    if (title) title.textContent = `Chat Window: ${currentRoom}`;
  });
});
document.querySelector("#chat-list-column .card")?.click(); // Auto-select first

// ========== Chat Functionality ==========
const usernameInput = document.getElementById("username");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("chat-messages");

function appendMessage(msg, isMe = false) {
  const div = document.createElement("div");
  div.classList.add("chat-bubble");
  div.classList.add(isMe ? "sent" : "received");
  div.textContent = msg;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function clearMessages() {
  messages.innerHTML = "";
}

function sendMessage() {
  const user = usernameInput.value.trim();
  const msg = messageInput.value.trim();
  if (user && msg && currentRoom) {
    socket.emit("send_message", { room: currentRoom, user, msg });
    appendMessage(`You: ${msg}`, true); // Show immediately
    messageInput.value = "";
  }
}

sendBtn?.addEventListener("click", sendMessage);
messageInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

socket.off("receive_message");
socket.on("receive_message", (data) => {
  if (data.room !== currentRoom) return;
  const isMe = data.user === usernameInput.value.trim();
  if (!isMe) appendMessage(`${data.user}: ${data.msg}`, false);
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
