import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3001);
const deezerBaseUrl = 'https://api.deezer.com';
const deezerCache = new Map();
const cacheTtlMs = 6 * 60 * 60 * 1000;
const requestIntervalMs = 130;
let nextDeezerRequestAt = 0;

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function normalizeName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function fetchDeezer(path) {
  const cached = deezerCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const startsAt = Math.max(Date.now(), nextDeezerRequestAt);
  nextDeezerRequestAt = startsAt + requestIntervalMs;
  if (startsAt > Date.now()) await new Promise((resolve) => setTimeout(resolve, startsAt - Date.now()));

  const response = await fetch(`${deezerBaseUrl}${path}`);
  const data = await response.json();
  if (!response.ok || data.error) {
    const message = data.error?.message ?? `Deezer returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  deezerCache.set(path, { value: data, expiresAt: Date.now() + cacheTtlMs });
  return data;
}

async function getRecentReleasesForArtist(artist, since, today) {
  const search = await fetchDeezer(`/search/artist?q=${encodeURIComponent(artist.name)}&limit=5`);
  const expectedName = normalizeName(artist.name);
  const deezerArtist = search.data?.find((result) => normalizeName(result.name) === expectedName);
  if (!deezerArtist) return [];

  const artistAlbums = [];
  let albumIndex = 0;
  let albumTotal = 0;
  do {
    const albumPage = await fetchDeezer(`/artist/${deezerArtist.id}/albums?limit=100&index=${albumIndex}`);
    artistAlbums.push(...(albumPage.data ?? []));
    albumTotal = albumPage.total ?? artistAlbums.length;
    if (!albumPage.data?.length) break;
    albumIndex += albumPage.data.length;
  } while (albumIndex < albumTotal);

  const recentAlbums = artistAlbums.filter((album) => album.release_date && album.release_date >= since && album.release_date <= today);
  const tracksById = new Map();

  for (const album of recentAlbums) {
    let trackIndex = 0;
    let trackTotal = 0;
    do {
      const trackPage = await fetchDeezer(`/album/${album.id}/tracks?limit=100&index=${trackIndex}`);
      for (const track of trackPage.data ?? []) {
        tracksById.set(String(track.id), {
          id: String(track.id),
          title: track.title,
          artistName: track.artist?.name ?? deezerArtist.name,
          albumName: album.title,
          albumCover: album.cover_medium ?? album.cover,
          albumUrl: album.link,
          trackUrl: track.link,
          releaseDate: album.release_date,
        });
      }
      trackTotal = trackPage.total ?? trackIndex + (trackPage.data?.length ?? 0);
      if (!trackPage.data?.length) break;
      trackIndex += trackPage.data.length;
    } while (trackIndex < trackTotal);
  }

  return [...tracksById.values()];
}

async function handleRecentReleases(request, response) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    json(response, 400, { error: error.message || 'Invalid JSON request.' });
    return;
  }

  if (!body || !Array.isArray(body.artists) || body.artists.length > 10) {
    json(response, 400, { error: 'Send a batch of up to 10 followed artists.' });
    return;
  }
  if (!Number.isInteger(body.days) || body.days < 1 || body.days > 365) {
    json(response, 400, { error: 'Choose a release window from 1 to 365 days.' });
    return;
  }
  if (body.artists.some((artist) => typeof artist?.name !== 'string' || artist.name.length > 200)) {
    json(response, 400, { error: 'Each artist must have a valid name.' });
    return;
  }

  const sinceDate = new Date();
  sinceDate.setUTCHours(0, 0, 0, 0);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (body.days - 1));
  const since = sinceDate.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const releaseLists = await Promise.all(body.artists.map((artist) => getRecentReleasesForArtist(artist, since, today)));
    const releases = releaseLists.flat().sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title));
    json(response, 200, { releases });
  } catch (error) {
    json(response, error.status ?? 502, { error: error.message || 'Could not fetch Deezer releases.' });
  }
}

const server = createServer((request, response) => {
  if (request.url === '/api/health' && request.method === 'GET') {
    json(response, 200, { status: 'ok' });
    return;
  }

  if (request.url === '/api/recent-releases' && request.method === 'POST') {
    void handleRecentReleases(request, response);
    return;
  }

  json(response, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Backend API listening on http://127.0.0.1:${port}`);
});
