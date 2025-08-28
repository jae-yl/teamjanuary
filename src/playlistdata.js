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

async function getTrackDataFromPlaylist(playlistData) {
  const tracks = playlistData.tracks.items;
  let trackData = {titles: [], artists: [], albums: []};

  for (let i = 0; i < 10; i++) {
    const currentTrack = tracks[i].track;
    const title = currentTrack.name;
    const artists = currentTrack.artists;
    const album = currentTrack.album;
    trackData.titles.push(title);
    for (const artist of artists) { trackData.artists.push(artist.name) }
    trackData.albums.push(album.name);
  }

  return trackData;
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

  data.genres = getGenreDataFromList(data.artists);

  return data;
}