import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { io } from "socket.io-client";

// Allow configurable socket URL (fallback to 3001)
const SOCKET_URL = window.SOCKET_URL || "http://127.0.0.1:3001";
const socket = io(SOCKET_URL);

// ----- Chat UI scaffold -----
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

// ----- State -----
let currentRoom = null;

// ----- Elements -----
const usernameInput = document.getElementById("username");
const messageInput  = document.getElementById("messageInput");
const sendBtn       = document.getElementById("sendBtn");
const messages      = document.getElementById("chat-messages");

// ----- Helpers -----
function appendMessage(msg, isMe = false) {
  const div = document.createElement("div");
  div.classList.add("chat-bubble", isMe ? "sent" : "received");
  div.textContent = msg;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}
function clearMessages() { messages.innerHTML = ""; }

// ----- History: register BEFORE any join_room happens -----
socket.on("load_messages", (rows = []) => {
  clearMessages();
  rows.forEach(r => {
    const name = r.username ?? r.user ?? "user";
    const text = r.message  ?? r.msg  ?? "";
    const isMe = name === (usernameInput?.value?.trim() || "");
    appendMessage(`${name}: ${text}`, isMe);
  });
});

// ----- Live messages: single, unified handler -----
socket.off("receive_message"); // ensure a single listener
socket.on("receive_message", (data = {}) => {
  // Normalize payload
  const name = data.username ?? data.user ?? "user";
  const text = data.message  ?? data.msg  ?? "";

  // If server includes room, filter by it
  if (data.room != null && data.room !== currentRoom) return;

  // Skip rendering our own broadcast (we already echo locally)
  const isMe = name === (usernameInput?.value?.trim() || "");
  if (isMe) return;

  appendMessage(`${name}: ${text}`, false);
});

// ----- Room switching -----
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

// Auto-select first room AFTER listeners are set
document.querySelector("#chat-list-column .card")?.click();

// ----- Sending -----
function sendMessage() {
  const user = usernameInput.value.trim();
  const msg  = messageInput.value.trim();
  if (!user || !msg || !currentRoom) return;

  socket.emit("send_message", { room: currentRoom, user, msg });
  appendMessage(`You: ${msg}`, true); // local echo
  messageInput.value = "";
}
sendBtn?.addEventListener("click", sendMessage);
messageInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// ----- Logout -----
document.getElementById("profile-pic-banner")?.addEventListener("click", () => {
  fetch('http://127.0.0.1:3000/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(res => res.ok ? res.json() : res.json().then(e => { throw new Error(e.error); }))
    .then(() => {
      localStorage.clear();
      window.location.href = "./index.html?m=lO";
    })
    .catch(console.error);
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

// ----- Spotify auth flow (unchanged) -----
const clientId = '4a01c36424064f4fb31bf5d5b586eb1f';
const redirectUrl = 'http://127.0.0.1:5173/dashboard.html';
const tokenEndpoint = "https://accounts.spotify.com/api/token";

async function getToken(code) {
  const code_verifier = localStorage.getItem('code_verifier');
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUrl,
      code_verifier,
    }),
  });
  return await response.json();
}

const currentToken = {
  get access_token() { return localStorage.getItem('access_token') || null; },
  get refresh_token() { return localStorage.getItem('refresh_token') || null; },
  get expires_in()    { return localStorage.getItem('refresh_in') || null; },
  get expires()       { return localStorage.getItem('expires') || null; },
  save(response) {
    const { access_token, refresh_token, expires_in } = response;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('expires_in',  expires_in);
    const now = new Date();
    const expiry = new Date(now.getTime() + (expires_in * 1000));
    localStorage.setItem('expires', expiry);
  }
};

const args = new URLSearchParams(window.location.search);
const code = args.get('code');
if (code) {
  const token = await getToken(code);
  currentToken.save(token);
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  const updatedUrl = url.search ? url.href : url.href.replace('?', '');
  window.history.replaceState({}, document.title, updatedUrl);
}

if (!currentToken.access_token) {
  window.location.replace("http://127.0.0.1:5173");
}

try {
  const userData = await getUserData();

  const verifyAccount = await fetch("http://127.0.0.1:3000/verifyaccount", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userData.id })
  });
  if (!verifyAccount.ok) {
    const error = await verifyAccount.json();
    throw new Error(error.error.message);
  }
  const account = await verifyAccount.json();

  if (!account.exists) {
    const spotifyPlaylistEndpoint = `https://api.spotify.com/v1/users/${userData.id}/playlists`;
    const reqBody = {
      name: "VibeMatch Playlist",
      description: "VibeMatch App playlist for preference match",
      public: false
    };
    const playlistCreate = await fetch(spotifyPlaylistEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentToken.access_token
      },
      body: JSON.stringify(reqBody)
    });
    if (!playlistCreate.ok) {
      const error = await playlistCreate.json();
      throw new Error(error.error.message);
    }
    const playlistData = await playlistCreate.json();

    const accountCreate = await fetch("http://127.0.0.1:3000/createaccount", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...userData, playlist_id: playlistData.id })
    });
    if (!accountCreate.ok) {
      const error = await accountCreate.json();
      throw new Error(error.error.message);
    }
  }

  const accountData = await fetch("http://127.0.0.1:3000/login", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userData.id })
  }).then(r => r.json());

  const playlist = await fetch(`https://api.spotify.com/v1/playlists/${accountData.playlist_id}`, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token }
  }).then(r => r.json());

  console.log(playlist);
} catch (error) {
  console.error("Error creating playlist:", error);
}

async function getUserData() {
  const response = await fetch("https://api.spotify.com/v1/me", {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  });
  return await response.json();
}