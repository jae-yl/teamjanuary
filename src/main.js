import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:3001');

const messages = document.querySelector('.main-chat-window .chat__messages');
const input = document.querySelector('.main-chat-window .chat__input');
const sendBtn = document.querySelector('.main-chat-window .chat__send');
const title = document.querySelector('.main-chat-window .chat__title');
const roomCards = Array.from(document.querySelectorAll('.chat-rooms .chat-room-card'));

function timeNow(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage({ text, who = 'them', user, timestamp = Date.now() }) {
  if (!messages || !text) return;
  const wrap = document.createElement('div');
  wrap.className = `msg ${who === 'me' ? 'msg--me' : 'msg--them'}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';
  bubble.textContent = text;
  const meta = document.createElement('span');
  meta.className = 'msg__meta';
  meta.textContent = `${who === 'me' ? 'You' : (user || 'User')} • ${timeNow(timestamp)}`;
  wrap.append(bubble, meta);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}
function clearMessages() { if (messages) messages.innerHTML = ''; }

function getChatUsername() {
  return localStorage.getItem('vm_display_name') || '';
}

let currentRoom = null;
function joinRoom(room, card = null) {
  if (!room) return;
  if (currentRoom) socket.emit('leave_room', currentRoom);
  currentRoom = room;
  socket.emit('join_room', currentRoom);
  clearMessages();
  if (title) title.textContent = `${currentRoom}`;
  if (card) roomCards.forEach(c => c.classList.toggle('active', c === card));
}
roomCards.forEach((card, i) => {
  const room = `chat-room-${i + 1}`;
  card.addEventListener('click', () => joinRoom(room, card));
});
if (!currentRoom) joinRoom('chat-room-1', roomCards[0] || null);

function sendMessage() {
  const user = getChatUsername();
  const msg = (input?.value || '').trim();
  if (!user || !msg || !currentRoom) return;

  addMessage({ text: msg, who: 'me', user });
  socket.emit('send_message', { room: currentRoom, user, msg });
  input.value = '';
}
sendBtn?.addEventListener('click', sendMessage);
input?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
socket.off('receive_message');
socket.on('receive_message', (data) => {
  if (data.room && data.room !== currentRoom) return;
  const mine = data.user === getChatUsername();
  if (!mine) addMessage({ text: data.msg, who: 'them', user: data.user, timestamp: data.timestamp || Date.now() });
});

const API = 'http://127.0.0.1:3000';
const profilePic = document.getElementById('profile-pic');
const profileName = document.getElementById('profile-name');
const signOutBtn = document.getElementById('signout-btn');

signOutBtn?.addEventListener('click', async () => {
  try {
    const r = await fetch(`${API}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    if (!r.ok) throw new Error(await r.text());
  } catch (e) { console.error(e); }
  localStorage.removeItem('vm_display_name');
  localStorage.removeItem('vm_avatar_url');
  localStorage.removeItem('vm_playlist_id');
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('expires_in');
  localStorage.removeItem('expires');
  window.location.href = './index.html?m=lO';
});

const clientId = '4a01c36424064f4fb31bf5d5b586eb1f';
const redirectUrl = 'http://127.0.0.1:5173/dashboard.html';
const tokenEndpoint = 'https://accounts.spotify.com/api/token';

const currentToken = {
  get access_token() { return localStorage.getItem('access_token') || null; },
  get refresh_token() { return localStorage.getItem('refresh_token') || null; },
  get expires_in() { return Number(localStorage.getItem('expires_in') || 0); },
  get expires() { return Number(localStorage.getItem('expires') || 0); },
  save(resp) {
    const { access_token, refresh_token, expires_in } = resp || {};
    if (access_token) localStorage.setItem('access_token', access_token);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    if (expires_in) {
      localStorage.setItem('expires_in', String(expires_in));
      localStorage.setItem('expires', String(Date.now() + expires_in * 1000));
    }
  }
};

async function getToken(code) {
  const code_verifier = localStorage.getItem('code_verifier');
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUrl,
      code_verifier
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function refreshToken() {
  const rt = currentToken.refresh_token;
  if (!rt) return;
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: rt
    })
  });
  if (!res.ok) throw new Error(await res.text());
  currentToken.save(await res.json());
}
async function ensureFreshToken() {
  if (!currentToken.access_token || Date.now() > currentToken.expires - 5000) {
    await refreshToken();
  }
}
async function fetchJson(url, init = {}) {
  await ensureFreshToken();
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}
async function getUserData() {
  return fetchJson('https://api.spotify.com/v1/me', {
    headers: { Authorization: 'Bearer ' + currentToken.access_token }
  });
}

const qp = new URLSearchParams(window.location.search);
const authCode = qp.get('code');
if (authCode) {
  try {
    const token = await getToken(authCode);
    currentToken.save(token);
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, document.title, url.search ? url.href : url.href.replace('?', ''));
  } catch (e) {
    console.error('Token exchange failed:', e);
  }
}

async function getAccountOrCreate(user) {
  const verify = await fetch(`${API}/verifyaccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: user.id })
  });
  const v = await verify.json();
  if (!verify.ok) throw new Error(v.error || 'verify failed');

  let playlistId;
  if (!v.exists) {
    const createReq = {
      name: 'VibeMatch Playlist',
      description: 'VibeMatch App playlist for preference match',
      public: false
    };
    const plRes = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + currentToken.access_token
      },
      body: JSON.stringify(createReq)
    });
    if (!plRes.ok) throw new Error(await plRes.text());
    const plJson = await plRes.json();
    playlistId = plJson.id;

    const accRes = await fetch(`${API}/createaccount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: user.display_name,
        email: user.email,
        id: user.id,
        playlist_id: playlistId
      })
    });
    const accJ = await accRes.json().catch(() => ({}));
    if (!accRes.ok) throw new Error(accJ.error || 'create account failed');
  }

  const loginRes = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: user.id })
  });
  const loginJ = await loginRes.json();
  if (!loginRes.ok) throw new Error(loginJ.error || 'login failed');
  return loginJ.playlist_id || playlistId;
}

function fillNavbar(user) {
  const display = (user.display_name || user.id || '').trim();
  const avatar = (user.images && user.images.length > 0) ? user.images[0].url : '';

  localStorage.setItem('vm_display_name', display);
  if (avatar) localStorage.setItem('vm_avatar_url', avatar);

  if (profilePic) profilePic.src = avatar || '';
  if (profileName) profileName.textContent = `Signed in as ${display}`;
}

async function loadAndRenderPlaylist(playlistId) {
  const container = document.getElementById('spotify-playlist');
  if (!container || !playlistId) return;

  const fields = 'name,external_urls';
  const pl = await fetchJson(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: 'Bearer ' + currentToken.access_token } }
  );

  const link = pl?.external_urls?.spotify || null;
  container.innerHTML = '';
  const a = document.createElement('a');
  a.textContent = pl?.name || 'VibeMatch Playlist';
  if (link) {
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  container.appendChild(a);
}

(async function init() {
  if (!currentToken.access_token) {
    window.location.replace('http://127.0.0.1:5173');
    return;
  }

  try {
    const user = await getUserData();
    fillNavbar(user);

    const playlistId = await getAccountOrCreate(user);
    localStorage.setItem('vm_playlist_id', playlistId || '');

    await loadAndRenderPlaylist(playlistId);
  } catch (e) {
    console.error(e);
  }
})();
