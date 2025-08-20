import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:3001");

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
  fetch('http://127.0.0.1:3000/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(res => {
    if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
    return res.json();
  }).then(() => {
    localStorage.clear();
    window.location.href = "./index.html?m=lO";
  }).catch(console.error);
});

// ========== Find Match ==========
document.getElementById('findMatchButton')?.addEventListener('click', () => {
  fetch('http://127.0.0.1:3000/findmatch', {
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

const clientId = '4a01c36424064f4fb31bf5d5b586eb1f';
const redirectUrl = 'http://127.0.0.1:5173/dashboard.html';
const tokenEndpoint = "https://accounts.spotify.com/api/token";

// Spotify API Calls
async function getToken(code) {
  const code_verifier = localStorage.getItem('code_verifier');

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUrl,
      code_verifier: code_verifier,
    }),
  });

  return await response.json();
}

// Data structure that manages the current active token, caching it in localStorage
const currentToken = {
  get access_token() { return localStorage.getItem('access_token') || null; },
  get refresh_token() { return localStorage.getItem('refresh_token') || null; },
  get expires_in() { return localStorage.getItem('refresh_in') || null },
  get expires() { return localStorage.getItem('expires') || null },

  save: function (response) {
    const { access_token, refresh_token, expires_in } = response;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('expires_in', expires_in);

    const now = new Date();
    const expiry = new Date(now.getTime() + (expires_in * 1000));
    localStorage.setItem('expires', expiry);
  }
};

// On page load, try to fetch auth code from current browser search URL
const args = new URLSearchParams(window.location.search);
const code = args.get('code');

// If we find a code, we're in a callback, do a token exchange
if (code) {
  const token = await getToken(code);
  currentToken.save(token);

  // Remove code from URL so we can refresh correctly.
  const url = new URL(window.location.href);
  url.searchParams.delete("code");

  const updatedUrl = url.search ? url.href : url.href.replace('?', '');
  window.history.replaceState({}, document.title, updatedUrl);
}

// If we have a token, we're logged in, so fetch user data
if (currentToken.access_token) {
  await getUserData().then(results => {
    fetch('http://127.0.0.1:3000/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(results)
    }).then(res => {
      if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
      return res.json();
    }).then(() => {
      console.log("Logged in!");
    }).catch(console.error);
  });
} else {
  window.location.replace("http://127.0.0.1:5173");
}

async function getUserData() {
  const response = await fetch("https://api.spotify.com/v1/me", {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  });

  return await response.json();
}