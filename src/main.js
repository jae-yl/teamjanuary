import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { io } from 'socket.io-client';

// ===== Socket base =====
const SOCKET_URL = window.SOCKET_URL || 'http://127.0.0.1:3001';
var socket;

// ===== Chat DOM =====
const messages = document.querySelector('.main-chat-window .chat__messages');
const input = document.querySelector('.main-chat-window .chat__input');
const sendBtn = document.querySelector('.main-chat-window .chat__send');
const title = document.querySelector('.main-chat-window .chat__title');
const chatRoomsContainer = document.getElementById('chat-rooms');

// ===== Collab DOM =====
let currentPlaylistId = null;
let currentPlaylistUrl = null;
const createCollabBtn = document.getElementById('create-collab-playlist-btn');
const collabPlaylistDisplay = document.getElementById('collab-playlist-display');
const addSongBtn = document.getElementById('add-song-btn');
const songUrlInput = document.getElementById('spotify-song-url');
const collaborativeSongList = document.getElementById('collaborative-song-list');
const collabFeedback = document.getElementById('collab-playlist-feedback');
const copyCollabLinkBtn = document.getElementById('copy-collab-link-btn');
const copyLinkFeedback = document.getElementById('copy-link-feedback');

// ===== Helpers =====
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
function getUserId() {
  return localStorage.getItem('vm_id') || '';
}

// ===== Rooms =====
let currentRoom = null;
function joinRoom(room, label = null) {
  if (room === null) return;
  if (currentRoom) socket.emit('leave_room', currentRoom);
  currentRoom = room;
  socket.emit('join_room', currentRoom);
  clearMessages();
  if (title) title.textContent = `Chat ${label || currentRoom}`;

  // ask server for current collaborative state in this room
  socket.emit('request_collab_state', { room: currentRoom });
}

// Click a chat room card
chatRoomsContainer?.addEventListener('click', (e) => {
  const chatCard = e.target.closest('.chat-room-card');
  if (!chatCard) return;
  joinRoom(chatCard.getAttribute('data-room-id'), chatCard.querySelector('.chat-room-name')?.textContent || chatCard.textContent);
}, false);

// ===== Send message =====
function sendMessage() {
  const user = getChatUsername();
  const msg = (input?.value || '').trim();
  if (!user || !msg || currentRoom === null) return;

  addMessage({ text: msg, who: 'me', user });
  socket.emit('send_message', { room: currentRoom, user, msg });
  input.value = '';
}
sendBtn?.addEventListener('click', sendMessage);
input?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ===== Navbar / Auth / Spotify =====
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
      code_verifier,
    }),
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

function fillNavbar(user) {
  const display = (user.display_name || user.id || '').trim();
  const avatar = (user.images && user.images.length > 0) ? user.images[0].url : '/defaultpfp.png';
  localStorage.setItem('vm_id', user.id);
  localStorage.setItem('vm_display_name', display);
  if (avatar) localStorage.setItem('vm_avatar_url', avatar);
  if (profilePic) profilePic.src = avatar || '';
  if (profileName) profileName.textContent = `Signed in as ${display}`;
}

var userChatsWith = [];
function addChatRoomCards(chats) {
  const tpl = document.getElementById('chat-room-template');
  for (let chatRoom of chats || []) {
    const frag = tpl.content.cloneNode(true);
    frag.querySelector('.chat-room-name').textContent = chatRoom.display_name;
    frag.querySelector('.profile-pic').src = chatRoom.pfp_link === 'n' ? '/defaultpfp.png' : chatRoom.pfp_link;
    frag.querySelector('.chat-room-card').setAttribute('data-room-id', chatRoom.chat_room_id);
    chatRoomsContainer.appendChild(frag);

    userChatsWith.push(chatRoom.room_member_id);
  }
}

async function getAccountOrCreate(user) {
  // verify
  const verify = await fetch(`${API}/verifyaccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: user.id })
  });
  const v = await verify.json();
  if (!verify.ok) throw new Error(v.error || 'verify failed');

  // create if needed
  if (!v.exists) {
    const accRes = await fetch(`${API}/createaccount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: user.display_name,
        email: user.email,
        id: user.id,
        user_pfp: user.images[0]?.url
      })
    });
    const accJ = await accRes.json().catch(() => ({}));
    if (!accRes.ok) throw new Error(accJ.error || 'create account failed');
  }

  // login + get chats
  const firstData = {};
  await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: user.id, user_pfp: user.images[0]?.url })
  })
  .then(r => {
    if (!r.ok) throw new Error('Login failed');
    return r.json();
  })
  .then(r => {
    addChatRoomCards(r.chats);
    firstData.id = r.chats[0]?.chat_room_id;
    firstData.display_name = r.chats[0]?.display_name;
  })
  .catch(e => console.log(e));

  return firstData;
}

// ===== Playlists (left column) =====
async function loadAndRenderPlaylists() {
  const container = document.getElementById('spotify-playlist');
  if (!container) return;

  await fetchJson(`https://api.spotify.com/v1/me/playlists?limit=10&offset=0`, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + currentToken.access_token },
  })
  .then(playlistsData => {
    if (playlistsData.items.length === 0) throw new Error('No playlists found');

    const tpl = document.getElementById('playlist-template');
    container.innerHTML = '';
    for (let playlist of playlistsData.items) {
      const card = tpl.content.cloneNode(true);
      card.querySelector('.card-image').src = playlist.images ? playlist.images[0]?.url : '';
      card.querySelector('.card-title').textContent = playlist.name || 'Untitled';
      card.querySelector('.card').setAttribute('data-playlist-id', playlist.id);
      container.appendChild(card);
      localStorage.setItem(`playlist_${playlist.id}`, JSON.stringify({ id: playlist.id, name: playlist.name }));
    }
  })
  .catch(e => { container.innerHTML = e.message; });
}

let pid = '';
document.getElementById('spotify-playlist-column')?.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  pid = card.getAttribute('data-playlist-id');
  // visual selection optional:
  document.querySelectorAll('.playlist-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
}, false);

const findMatchButton = document.getElementById('find-match-button');
if (!findMatchButton) console.log('cannot find findmatch button');

findMatchButton.addEventListener('click', async () => {
  if (!pid) {
    alert('Please select a playlist first!');
  } else {
    if (findMatchButton.getAttribute('data-searching') == "true") {
      findMatchButton.textContent = "Match my Vibe";
      findMatchButton.setAttribute('data-searching', false);
      socket.emit('stop_searching');
    } else {
      findMatchButton.textContent = "Matching...";
      findMatchButton.setAttribute('data-searching', true);
      const rawArtists = await fetchJson(`https://api.spotify.com/v1/playlists/${pid}/tracks?fields=items%28track%28artists%28name%29%29%29limit=50`, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + currentToken.access_token },
      });
      const artists = new Set(rawArtists.items.map(item => item.track.artists.map(a => a.name)).flat());
      socket.emit('search_for_room', [...artists]);
    }
  }
});

// ===== Collaborative playlist features =====
async function createCollaborativePlaylist() {
  try {
    const user = await getUserData();
    const createReq = {
      name: `VibeMatch Collab - ${currentRoom}`,
      description: `Collaborative playlist for ${currentRoom}`,
      public: false,
      collaborative: true
    };
    const res = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + currentToken.access_token
      },
      body: JSON.stringify(createReq)
    });
    if (!res.ok) throw new Error(await res.text());
    const playlist = await res.json();
    currentPlaylistId = playlist.id;

    // tell the room
    socket.emit('create_collab_playlist', {
      room: currentRoom,
      playlistId: currentPlaylistId,
      playlistName: playlist.name,
      playlistUrl: playlist.external_urls.spotify
    });

    renderCollaborativePlaylist(playlist.name, playlist.external_urls.spotify);
    collabFeedback.textContent = 'Collaborative playlist created!';
  } catch (e) {
    console.error('Error creating playlist:', e);
    collabFeedback.textContent = 'Failed to create collaborative playlist.';
  }
}
function renderCollaborativePlaylist(name, url) {
  collabPlaylistDisplay.innerHTML = '';
  currentPlaylistUrl = url;
  const a = document.createElement('a');
  a.textContent = name;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  collabPlaylistDisplay.appendChild(a);
}
function copyCollaborativeLink() {
  if (!currentPlaylistUrl) {
    copyLinkFeedback.textContent = 'No playlist link available.';
    return;
  }
  navigator.clipboard.writeText(currentPlaylistUrl)
    .then(() => {
      copyLinkFeedback.textContent = 'Collaborative link copied!';
      setTimeout(() => copyLinkFeedback.textContent = '', 2500);
    })
    .catch(err => {
      console.error('Error copying link:', err);
      copyLinkFeedback.textContent = 'Failed to copy link.';
    });
}
async function addSongToPlaylist() {
  const url = songUrlInput?.value.trim();
  if (!url || !currentPlaylistId) return;
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  if (!match) {
    collabFeedback.textContent = 'Invalid Spotify track URL';
    return;
  }
  const trackUri = `spotify:track:${match[1]}`;
  try {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${currentPlaylistId}/tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + currentToken.access_token
      },
      body: JSON.stringify({ uris: [trackUri] })
    });
    if (!res.ok) throw new Error(await res.text());

    const trackName = await fetch(`https://api.spotify.com/v1/tracks/${match[1]}`, {
      headers: { Authorization: 'Bearer ' + currentToken.access_token }
    }).then(r => r.json()).then(d => d.name);

    // echo to room
    socket.emit('add_song', { room: currentRoom, songName: trackName, user: getChatUsername() });

    collabFeedback.textContent = `Added: ${trackName}`;
    songUrlInput.value = '';
  } catch (e) {
    console.error('Error adding song:', e);
    collabFeedback.textContent = 'Failed to add song.';
  }
}
createCollabBtn?.addEventListener('click', createCollaborativePlaylist);
addSongBtn?.addEventListener('click', addSongToPlaylist);
copyCollabLinkBtn?.addEventListener('click', copyCollaborativeLink);

// ===== Init =====
(async function init() {
  if (!currentToken.access_token) {
    window.location.replace('http://127.0.0.1:5173');
    return;
  }

  try {
    const user = await getUserData();
    fillNavbar(user);

    const firstRoom = await getAccountOrCreate(user);

    // set up socket w/ metadata for matching
    socket = io(SOCKET_URL, {
      query: {
        userId: user.id,
        existingChats: JSON.stringify(userChatsWith),
        userPfp: localStorage.getItem('vm_avatar_url'),
        userDisplay: localStorage.getItem('vm_display_name')
      }
    });

    // history load (use styled bubbles now)
    socket.on('load_messages', (rows = []) => {
      clearMessages();
      rows.forEach(r => {
        const name = r.username ?? r.user ?? 'user';
        const text = r.message ?? r.msg ?? '';
        const who = name === getChatUsername() ? 'me' : 'them';
        addMessage({ text, who, user: name, timestamp: r.timestamp ? Date.parse(r.timestamp) : Date.now() });
      });
    });

    // realtime chat
    socket.off('receive_message');
    socket.on('receive_message', (data) => {
      if (data.room && data.room !== currentRoom) return;
      const mine = data.user === getChatUsername();
      if (!mine) addMessage({ text: data.msg, who: 'them', user: data.user, timestamp: data.timestamp || Date.now() });
    });

    // vibe-matching → new room
    socket.on('matched_room', (data) => {
      findMatchButton.textContent = "Match my Vibe";
      findMatchButton.setAttribute('data-searching', false);
      socket.emit('stop_searching');
      
      if (getUserId() == data.user1) {
        addChatRoomCards([{ display_name: data.user2display, pfp_link: data.user2pfp, chat_room_id: data.room_id }]);
        joinRoom(data.room_id, data.user2display);
      } else {
        addChatRoomCards([{ display_name: data.user1display, pfp_link: data.user1pfp, chat_room_id: data.room_id }]);
        joinRoom(data.room_id, data.user1display);
      }
    });

    // collab state push
    socket.on('collab_playlist_created', (data) => {
      if (data.room !== currentRoom) return;
      currentPlaylistId = data.playlistId;
      renderCollaborativePlaylist(data.playlistName, data.playlistUrl);
    });

    socket.on('song_added', (data) => {
      if (data.room !== currentRoom) return;
      const li = document.createElement('li');
      li.textContent = data.songName;
      collaborativeSongList.appendChild(li);
      addMessage({ text: `Song added: ${data.songName}`, who: 'them', user: data.user });
    });

    socket.on('collab_state', (data) => {
      if (data.room !== currentRoom) return;
      if (data.playlistId && data.playlistName && data.playlistUrl) {
        currentPlaylistId = data.playlistId;
        renderCollaborativePlaylist(data.playlistName, data.playlistUrl);
      }
      if (Array.isArray(data.songs)) {
        collaborativeSongList.innerHTML = '';
        data.songs.forEach(song => {
          const li = document.createElement('li');
          li.textContent = song;
          collaborativeSongList.appendChild(li);
        });
      }
    });

    // enter the first room from server
    joinRoom(firstRoom.id, firstRoom.display_name);

    // load playlists
    await loadAndRenderPlaylists();
  } catch (e) {
    console.error(e);
  }
})();