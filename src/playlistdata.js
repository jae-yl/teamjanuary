import { fetchJson, currentToken, socket } from "./main.js";

const matchStatusEl = document.getElementById('matchStatus');       
const cancelMatchBtn = document.getElementById('cancelMatchButton'); 

cancelMatchBtn?.addEventListener('click', () => {
  if (matchState !== MatchState.QUEUING) return;
  socket.emit('cancel_queue');
  setMatchState(MatchState.IDLE);
});

async function getPlaylistFromUrl(playlistUrl, accessToken) {
  const id = extractPlaylistId(playlistUrl);
  const res = await fetch(`https://api.spotify.com/v1/playlists/${id}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`}
  });
  return res.json();
}

async function getTrackFromId(id, accessToken) {
  const res = await fetch(`https://api.spotify.com/v1/audio-features/${id}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`}
  });
  return res.json();
}

function extractPlaylistId(input) {
  // spotify URI handler
  const mUri = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/i);
  if (mUri) return mUri[1];

  // spotify URL handler
  const url = new URL(input);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("playlist");
  if (i >= 0 && parts[i + 1]) return parts[i + 1];

  return null;
}

async function getArtistGenreData(id) {
  const res = await fetch(`https://api.spotify.com/v1/artists/${id}`, {
      headers: {'Authorization': `Bearer ${currentToken.access_token}`}
  });
  return res.json();
}

async function getGenreDataFromList(artists) {
  let out = [];

  for (const artist of artists) {
    const artistData = await getArtistGenreData(artist.id);
    for (const genre of artistData.genres) {
      out.push(genre);
    }
  }

  return out;
}

async function getTrackDataFromPlaylist(playlistData) {
  let data = {tracks: [], artists: [], albums: [], genres: []};
  const tracks = playlistData.tracks.items;

  for (let i = 0; i < 10; i++) {
    const track = tracks[i].track;
    const artists = track.artists;
    const album = track.album;

    data.tracks.push(track);
    for (const artist of artists) { data.artists.push(artist) }
    data.albums.push(album);
  }

  data.genres = await getGenreDataFromList(data.artists);

  return data;
}

const MatchState = Object.freeze({ IDLE: 'idle', QUEUING: 'queueing', CHATTING: 'chatting' });
let matchState = MatchState.IDLE;

function setMatchState(next) {
  matchState = next;
  if (matchStatusEl) {
    matchStatusEl.textContent =
      next === MatchState.QUEUING ? 'Looking for a match…' :
      next === MatchState.CHATTING ? '' : '';
  }
  if (cancelMatchBtn) cancelMatchBtn.style.display = (next === MatchState.QUEUING) ? '' : 'none';
}

socket.off('queued');
socket.on('queued', () => {
  // Still waiting — UI already shows "Looking for a match…"
});

socket.off('match_error');
socket.on('match_error', (msg) => {
  console.warn('match_error:', msg);
  setMatchState(MatchState.IDLE);
  if (matchStatusEl) matchStatusEl.textContent = 'Could not find a match.';
});

// When matched, tell the chat UI to switch rooms.
socket.off('matched');
socket.on('matched', ({ room, users }) => {
  console.log('Matched:', room, users);
  setMatchState(MatchState.CHATTING);

  // Let main.js (chat UI) know which room to join.
  // It can listen for this event and call its existing joinRoom(room).
  window.dispatchEvent(new CustomEvent('vibematch:matched', { detail: { room, users } }));

  // Also persist so a soft refresh can restore the DM
  try { localStorage.setItem('vm_matched_room', room); } catch {}
});

document.getElementById('findMatchButton')?.addEventListener('click', async () => {
  try {
    console.log("find match clicked");

    const playlistUrl = document.getElementById('playlistUrl')?.value?.trim();
    if (!playlistUrl) {
      console.warn('No playlist URL provided');
      return;
    }

    // Pull playlist + derive tracks/artists/albums/genres
    const playlistData = await getPlaylistFromUrl(playlistUrl, currentToken.access_token);
    console.log('Client validated playlist:', playlistData?.name, playlistData?.id);

    const trackData = await getTrackDataFromPlaylist(playlistData);
    console.log('Track data:', trackData);

    // Build lean preference payload for the server’s matcher
    const prefs = {
      playlist_id: playlistData?.id || null,
      tracks:  [...new Set(trackData.tracks.map(t => t.id).filter(Boolean))],
      artists: [...new Set(trackData.artists.map(a => a.id).filter(Boolean))],
      albums:  [...new Set(trackData.albums.map(a => a.id).filter(Boolean))],
      genres:  [...new Set(trackData.genres.filter(Boolean))]
    };

    // Queue for a match over Socket.IO (same socket instance as main.js)
    socket.emit('queue_for_match', prefs);
    setMatchState(MatchState.QUEUING);

  } catch (e) {
    console.error(e);
    setMatchState(MatchState.IDLE);
  }
});