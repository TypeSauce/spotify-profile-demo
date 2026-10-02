import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type SpotifyProfile = {
  display_name: string;
  id: string;
  email?: string;
  uri: string;
  href: string;
  external_urls: { spotify: string };
  images: Array<{ url: string }>;
};

type SpotifyArtist = {
  id: string;
  name: string;
  images: Array<{ url: string }>;
  genres?: string[];
  external_urls: { spotify: string };
};

type FollowedArtistsPage = {
  artists: {
    items: SpotifyArtist[];
    total: number;
    cursors: { after: string | null };
  };
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  images?: Array<{ url: string }>;
  external_urls: { spotify: string };
  owner: { id: string };
  public: boolean | null;
  items?: { total: number };
};

type DeezerRelease = {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  albumCover?: string;
  albumUrl?: string;
  trackUrl?: string;
  releaseDate: string;
};


const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '5b97ff95b5034a8aa4114c3c06564fe7';
const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? window.location.origin;

function randomString(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]).join('');
}

async function createChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signIn() {
  const verifier = randomString(128);
  localStorage.setItem('spotify-verifier', verifier);
  const challenge = await createChallenge(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'user-read-private user-read-email user-follow-read playlist-read-private',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function fetchSpotifyData(): Promise<{ profile: SpotifyProfile; accessToken: string }> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) throw new Error('Spotify did not return an authorization code.');

  const verifier = localStorage.getItem('spotify-verifier');
  if (!verifier) throw new Error('Your sign-in session expired. Please try again.');

  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(tokenData.error_description ?? 'Spotify sign-in failed.');

  const profileResponse = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error(profile.error?.message ?? 'Could not load your Spotify profile.');

  localStorage.removeItem('spotify-verifier');
  window.history.replaceState({}, document.title, window.location.pathname);
  return { profile, accessToken: tokenData.access_token };
}

async function fetchFollowedArtists(accessToken: string, after?: string | null) {
  const params = new URLSearchParams({ type: 'artist', limit: '50' });
  if (after) params.set('after', after);
  const data = await fetchSpotifyJson<FollowedArtistsPage>(`https://api.spotify.com/v1/me/following?${params}`, accessToken);
  return data.artists;
}

async function fetchAllFollowedArtists(accessToken: string) {
  const items: SpotifyArtist[] = [];
  let after: string | null = null;
  let total = 0;

  do {
    const page = await fetchFollowedArtists(accessToken, after);
    items.push(...page.items);
    total = page.total;
    after = page.cursors.after;
    if (page.items.length === 0) break;
  } while (after);

  return { items, total };
}

async function fetchSpotifyJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'A Spotify request failed.');
  return data as T;
}

async function fetchPublicPlaylists(accessToken: string, userId: string) {
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;
  let total = 0;
  do {
    const page = await fetchSpotifyJson<{ items: SpotifyPlaylist[]; total: number }>(
      `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`,
      accessToken,
    );
    playlists.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
    offset += page.items.length;
  } while (offset < total);

  return playlists.filter((playlist) => playlist.public === true && playlist.owner.id === userId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}


async function fetchRecentReleases(artists: SpotifyArtist[], days: number) {
  const response = await fetch('/api/recent-releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artists: artists.map(({ id, name }) => ({ id, name })), days }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not load recent releases from Deezer.');
  return data.releases as DeezerRelease[];
}

const itemsPerPage = 10;

function Pagination({ label, page, pageCount, onPageChange }: {
  label: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount < 2) return null;
  return (
    <nav className="artist-pagination" aria-label={`${label} pages`}>
      <button className="pagination-button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button className="pagination-button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page === pageCount}>Next</button>
    </nav>
  );
}

function App() {
  const [profile, setProfile] = React.useState<SpotifyProfile | null>(null);
  const [artists, setArtists] = React.useState<SpotifyArtist[]>([]);
  const [artistsTotal, setArtistsTotal] = React.useState(0);
  const [artistPage, setArtistPage] = React.useState(1);
  const [playlists, setPlaylists] = React.useState<SpotifyPlaylist[]>([]);
  const [playlistPage, setPlaylistPage] = React.useState(1);
  const [releases, setReleases] = React.useState<DeezerRelease[]>([]);
  const [releaseDaysInput, setReleaseDaysInput] = React.useState('7');
  const [searchedReleaseDays, setSearchedReleaseDays] = React.useState<number | null>(null);
  const [releaseScanProgress, setReleaseScanProgress] = React.useState(0);
  const [artistsError, setArtistsError] = React.useState('');
  const [playlistsError, setPlaylistsError] = React.useState('');
  const [releasesError, setReleasesError] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [artistsLoading, setArtistsLoading] = React.useState(false);
  const [playlistsLoading, setPlaylistsLoading] = React.useState(false);
  const [releasesLoading, setReleasesLoading] = React.useState(false);
  const hasCode = new URLSearchParams(window.location.search).has('code');
  const parsedReleaseDays = Number(releaseDaysInput);
  const validReleaseDays = /^\d+$/.test(releaseDaysInput) && parsedReleaseDays >= 1 && parsedReleaseDays <= 365;

  React.useEffect(() => {
    if (!hasCode) return;
    setLoading(true);
    fetchSpotifyData()
      .then(async ({ profile: loadedProfile, accessToken }) => {
        setProfile(loadedProfile);
        setLoading(false);
        setArtistsLoading(true);
        setPlaylistsLoading(true);


        const [followedResult, playlistsResult] = await Promise.allSettled([
          fetchAllFollowedArtists(accessToken),
          fetchPublicPlaylists(accessToken, loadedProfile.id),
        ]);

        let followedArtists: SpotifyArtist[] = [];
        if (followedResult.status === 'fulfilled') {
          followedArtists = followedResult.value.items.sort((artistA, artistB) =>
            artistA.name.localeCompare(artistB.name, undefined, { sensitivity: 'base' }),
          );
          setArtists(followedArtists);
          setArtistsTotal(followedResult.value.total);
        } else {
          setArtistsError(followedResult.reason instanceof Error ? followedResult.reason.message : 'Could not load your followed artists.');
        }
        setArtistsLoading(false);

        if (playlistsResult.status === 'fulfilled') {
          setPlaylists(playlistsResult.value);
        } else {
          setPlaylistsError(playlistsResult.reason instanceof Error ? playlistsResult.reason.message : 'Could not load your public playlists.');
        }
        setPlaylistsLoading(false);

      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Something went wrong.'))
      .finally(() => setLoading(false));
  }, [hasCode]);

  async function scanAllReleases() {
    const isNewSearch = searchedReleaseDays !== parsedReleaseDays;
    if (releasesLoading || !validReleaseDays || (!isNewSearch && releaseScanProgress >= artists.length)) return;
    const startAt = isNewSearch ? 0 : releaseScanProgress;
    setReleasesError('');
    setReleasesLoading(true);
    if (isNewSearch) setReleaseScanProgress(0);
    try {
      for (let start = startAt; start < artists.length; start += 10) {
        const batch = artists.slice(start, start + 10);
        const batchReleases = await fetchRecentReleases(batch, parsedReleaseDays);
        const sortedBatch = [...batchReleases].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title));
        if (isNewSearch && start === 0) {
          setReleases(sortedBatch);
          setSearchedReleaseDays(parsedReleaseDays);
        } else {
          setReleases((current) => {
            const byId = new Map(current.map((release) => [release.id, release] as const));
            for (const release of sortedBatch) byId.set(release.id, release);
            return [...byId.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title));
          });
        }
        setReleaseScanProgress(start + batch.length);
      }
    } catch (cause) {
      setReleasesError(cause instanceof Error ? cause.message : 'Could not load recent releases from Deezer.');
    } finally {
      setReleasesLoading(false);
    }
  }

  const artistPageCount = Math.ceil(artists.length / itemsPerPage);
  const playlistPageCount = Math.ceil(playlists.length / itemsPerPage);
  const visibleArtists = artists.slice((artistPage - 1) * itemsPerPage, artistPage * itemsPerPage);
  const visiblePlaylists = playlists.slice((playlistPage - 1) * itemsPerPage, playlistPage * itemsPerPage);

  return (
    <main className="page-shell">
      <div className="dashboard">
        <section className="profile-card section-card" aria-labelledby="profile-heading">
          <div className="brand-mark" aria-hidden="true">♫</div>
          <p className="eyebrow">YOUR MUSIC, YOUR PROFILE</p>
          <h1 id="profile-heading">{profile ? `Hey, ${profile.display_name}` : 'Meet your Spotify profile'}</h1>
          {!profile && <p className="intro">Connect your Spotify account to see your profile details in one place.</p>}
          {loading && <p className="status">Signing in to Spotify…</p>}
          {error && <p className="error" role="alert">{error}</p>}

          {profile ? (
            <div className="profile-content">
              {profile.images[0] && <img className="avatar" src={profile.images[0].url} alt={`${profile.display_name}'s Spotify profile`} />}
              <dl>
                <div><dt>User ID</dt><dd>{profile.id}</dd></div>
                <div><dt>Email</dt><dd>{profile.email || 'Not shared'}</dd></div>
                <div><dt>Spotify URI</dt><dd><a href={profile.external_urls.spotify}>{profile.uri}</a></dd></div>
                <div><dt>Profile link</dt><dd><a href={profile.href}>Open Spotify profile</a></dd></div>
              </dl>
            </div>
          ) : (
            <button className="sign-in-button" onClick={() => void signIn()} disabled={loading}>
              <span aria-hidden="true">▶</span> Continue with Spotify
            </button>
          )}
          <p className="footnote">Secure sign-in with Spotify · You can revoke access anytime</p>
        </section>

        {profile && (
          <>
            <section className="content-card" aria-labelledby="artists-heading">
              <SectionHeading eyebrow="YOUR LIBRARY" id="artists-heading" title="Followed artists" count={artistsTotal} />
              {artistsLoading && <p className="status">Loading your followed artists…</p>}
              {artistsError && <SectionError message={artistsError} onReconnect={() => void signIn()} />}
              {!artistsLoading && !artistsError && artists.length === 0 ? (
                <p className="empty-state">You’re not following any artists yet.</p>
              ) : (
                <div className="artist-list">
                  {visibleArtists.map((artist) => (
                    <a className="artist-row" href={artist.external_urls.spotify} key={artist.id} target="_blank" rel="noreferrer">
                      {artist.images?.[0] ? <img src={artist.images[0].url} alt="" loading="lazy" /> : <span className="artist-placeholder" aria-hidden="true">♫</span>}
                      <span className="artist-details">
                        <span className="artist-name">{artist.name}</span>
                        <span className="artist-genres">{artist.genres?.length ? artist.genres.slice(0, 3).join(' · ') : 'Artist'}</span>
                      </span>
                      <span className="artist-link-mark" aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              )}
              <Pagination label="Artist" page={artistPage} pageCount={artistPageCount} onPageChange={setArtistPage} />
            </section>

            <section className="content-card" aria-labelledby="playlists-heading">
              <SectionHeading eyebrow="YOUR COLLECTION" id="playlists-heading" title="Public playlists" count={playlists.length} />
              {playlistsLoading && <p className="status">Loading your public playlists…</p>}
              {playlistsError && <SectionError message={playlistsError} onReconnect={() => void signIn()} />}
              {!playlistsLoading && !playlistsError && playlists.length === 0 ? (
                <p className="empty-state">You don’t have any public playlists yet.</p>
              ) : (
                <div className="artist-list">
                  {visiblePlaylists.map((playlist) => (
                    <a className="artist-row" href={playlist.external_urls.spotify} key={playlist.id} target="_blank" rel="noreferrer">
                      {playlist.images?.[0] ? <img className="playlist-cover" src={playlist.images[0].url} alt="" loading="lazy" /> : <span className="artist-placeholder playlist-cover" aria-hidden="true">♫</span>}
                      <span className="artist-details">
                        <span className="artist-name">{playlist.name}</span>
                        <span className="artist-genres">{playlist.items?.total ?? 0} tracks · Public playlist</span>
                      </span>
                      <span className="artist-link-mark" aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              )}
              <Pagination label="Playlist" page={playlistPage} pageCount={playlistPageCount} onPageChange={setPlaylistPage} />
            </section>

            <section className="content-card" aria-labelledby="releases-heading">
              <SectionHeading eyebrow="RECENT RELEASES" id="releases-heading" title="New songs from followed artists" count={releases.length} />
              <p className="section-description">Choose a release window. Songs appear as each group of followed artists is checked.</p>
              <div className="release-controls">
                <label htmlFor="release-days">Released within the last</label>
                <input
                  id="release-days"
                  type="number"
                  min={1}
                  max={365}
                  value={releaseDaysInput}
                  disabled={releasesLoading}
                  aria-invalid={!validReleaseDays}
                  onChange={(event) => setReleaseDaysInput(event.currentTarget.value)}
                />
                <span>days</span>
              </div>
              {!validReleaseDays && <p className="error" role="alert">Enter a whole number from 1 to 365 days.</p>}
              {searchedReleaseDays !== null && searchedReleaseDays !== parsedReleaseDays && (
                <p className="status">
                  Showing the previous {searchedReleaseDays}-day search until the new search returns results.
                  {releases.length === 0 ? ' No songs matched that previous search.' : ''}
                </p>
              )}
              {releasesError && <p className="error" role="alert">{releasesError}</p>}
              {artistsLoading && <p className="status">Loading followed artists before the Deezer scan...</p>}
              {artistsError && <p className="empty-state">Reconnect Spotify to load your followed artists before checking releases.</p>}
              {!artistsLoading && !artistsError && artists.length === 0 ? (
                <p className="empty-state">Follow artists first to look for their recent releases.</p>
              ) : releases.length > 0 ? (
                <div className="artist-list">
                  {releases.map((release) => (
                    <a className="artist-row" href={release.trackUrl || release.albumUrl || '#'} key={release.id} target="_blank" rel="noreferrer">
                      {release.albumCover ? <img className="playlist-cover" src={release.albumCover} alt="" loading="lazy" /> : <span className="artist-placeholder playlist-cover" aria-hidden="true">&#9835;</span>}
                      <span className="artist-details">
                        <span className="artist-name">{release.title}</span>
                        <span className="artist-genres">{release.artistName} · {release.albumName}</span>
                      </span>
                      <time className="release-date" dateTime={release.releaseDate}>{new Date(`${release.releaseDate}T12:00:00`).toLocaleDateString()}</time>
                    </a>
                  ))}
                </div>
              ) : !releasesLoading && searchedReleaseDays === parsedReleaseDays && releaseScanProgress >= artists.length && artists.length > 0 ? (
                <p className="empty-state">No matching Deezer releases were found in the last {searchedReleaseDays} days.</p>
              ) : releaseScanProgress === 0 && !releasesLoading && !artistsLoading && !artistsError && artists.length > 0 ? (
                <p className="empty-state">Start one scan to check all followed artists. Results will appear as each batch finishes.</p>
              ) : null}
              {releasesLoading && <p className="status">Checked {releaseScanProgress} of {artists.length} followed artists. Continuing automatically...</p>}
              {!artistsLoading && !artistsError && validReleaseDays && (searchedReleaseDays !== parsedReleaseDays || releaseScanProgress < artists.length) && (
                <button className="scan-button" onClick={() => void scanAllReleases()} disabled={releasesLoading}>
                  {releasesLoading ? 'Scanning Deezer...' : searchedReleaseDays !== parsedReleaseDays ? `Search the last ${parsedReleaseDays} days` : 'Continue scan'}
                </button>
              )}
            </section>

          </>
        )}
      </div>
    </main>
  );
}

function SectionHeading({ eyebrow, id, title, count }: { eyebrow: string; id: string; title: string; count: number }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <span className="artists-count">{count.toLocaleString()}</span>
    </div>
  );
}

function SectionError({ message, onReconnect }: { message: string; onReconnect: () => void }) {
  return <><p className="error" role="alert">{message}</p><button className="reconnect-button" onClick={onReconnect}>Reconnect Spotify</button></>;
}

createRoot(document.getElementById('root')!).render(<App />);
