# Spotify Profile

A React single page app for signing in with Spotify, viewing profile details, browsing followed artists and public playlists, and checking recent releases through Deezer. The repository is organized as a small npm workspace with separate frontend and backend apps.

## Structure

- `frontend/` — React, TypeScript, and Vite SPA
- `backend/` — Node HTTP API service (`GET /api/health`)

## Run locally

1. From this directory, run `npm install`.
2. Copy `frontend/.env.example` to `frontend/.env.local` and set your Spotify app client ID and redirect URI. Register the same redirect URI in your Spotify developer dashboard.
3. Start the API with `npm run dev:backend`.
4. In another terminal, start the SPA with `npm run dev:frontend`.

The Vite server runs at `http://127.0.0.1:5173` and proxies `/api` requests to the backend at `http://127.0.0.1:3001`.

The Spotify authorization code flow uses PKCE in the browser, so no client secret is stored in this project. Sign-in requests `user-follow-read` for followed artists and `playlist-read-private` to retrieve playlists; the app only displays public playlists owned by the signed-in user. The recent release section lets you choose a window of 1 to 365 days. One scan automatically checks every followed artist in batches of 10, showing results as batches finish. Deezer requests are paced at about 8 per second, and successful responses are cached in memory for six hours.
