import { fetchJson, currentToken } from "./main.js";

// ========== Find Match ==========
document.getElementById('findMatchButton')?.addEventListener('click', async () => {
    console.log("find match clicked");

    const playlistUrl = document.getElementById('playlistUrl').value;
    if (!playlistUrl) {
        console.warn('No playlist URL provided');
        return;
    }

    const playlistData = await getPlaylistFromUrl(playlistUrl, currentToken.access_token);
    console.log('Client validated playlist:', playlistData?.name, playlistData?.id);
    console.log('Playlist data:', playlistData);

    const trackData = await getTrackDataFromPlaylist(playlistData);
    console.log('Track data:', trackData);

    fetch('http://127.0.0.1:3000/findmatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(trackData)
    }).then(res => {
        if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
        return res.json();
    }).then(data => {
        console.log("Match found:", data);
    }).catch(console.error);
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