// Test double for Spotify and Last.fm, loaded only on http://127.0.0.1 with ?mock in the address.
// Every call is logged in window.__mock.log. ?mock=quota makes search hit QUOTA_EXCEEDED after
// window.__mock.quotaAfter searches. Nothing here reaches the network.

const ARTISTS = [
  ["Kordhell", "phonk"], ["DVRST", "phonk"], ["Interworld", "phonk"], ["Pharmacist", "phonk"],
  ["Ghostface Playa", "phonk"], ["Dxrk", "phonk"], ["Drake", "hip hop"], ["Travis Scott", "hip hop"],
  ["Future", "hip hop"], ["21 Savage", "hip hop"], ["Metro Boomin", "hip hop"], ["Don Toliver", "hip hop"],
  ["Dua Lipa", "pop"], ["The Weeknd", "pop"], ["Doja Cat", "pop"], ["Sabrina Carpenter", "pop"],
  ["Nujabes", "lofi"], ["Jinsang", "lofi"], ["Tomppabeats", "lofi"], ["Сироп", "phonk"],
];
const WORDS = ["Night", "Drive", "Rage", "Close Eyes", "Murder", "Sahara", "Memory", "Neon", "Fade", "Gravity", "Smoke", "Echo", "Velvet", "Static", "Ghost", "Heat"];

const tracks = [];
let n = 0;
const id22 = (i) => `mock${String(i).padStart(18, "0")}`;
ARTISTS.forEach(([artist, genre], ai) => {
  for (let k = 0; k < 7; k++) {
    const name = `${WORDS[(ai * 3 + k) % WORDS.length]} ${ai}${k}`;
    const t = { id: id22(n++), name, artist, genre };
    tracks.push(t);
    if (k < 3) tracks.push({ id: id22(n++), name: `${name} - Slowed`, artist, genre }); // slowed versions
    if (k === 0) tracks.push({ id: id22(n++), name: `${name} (Sped Up)`, artist, genre });
  }
});
const byId = new Map(tracks.map((t) => [t.id, t]));
const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
// Cover art as inline SVG (nothing is fetched); the page only shows https images, so mock rows stay gray.
const img = (t) => [64, 300, 640].map((w) => ({ url: `data:image/svg+xml,mock-${w}-${t.id}`, width: w, height: w }));
const api = (t) => ({
  id: t.id,
  uri: `spotify:track:${t.id}`,
  name: t.name,
  artists: [{ name: t.artist, id: norm(t.artist) }],
  album: { images: img(t) },
  is_playable: true,
});

const state = {
  log: [],
  quotaAfter: 25,
  searches: 0,
  device: { id: "dev1", name: "Pixel 8", type: "Smartphone", is_active: true, is_restricted: false },
  playing: tracks[0],
  progress: 61000,
  queue: [],
  liked: new Set(tracks.filter((_, i) => i % 5 === 0).map((t) => `spotify:track:${t.id}`)),
  playlists: [],
  noDevice: false,
};
window.__mock = state;

const json = (body, status = 200, headers = {}) =>
  new Response(body == null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// ------------------------------------------------------------ Last.fm
function lastfm(u) {
  const p = u.searchParams;
  const m = p.get("method");
  const pick = (list) => list.map((t) => ({ name: t.name, artist: { name: t.artist }, match: "0.5" }));
  if (p.get("api_key") === "bad") return json({ error: 10, message: "Invalid API key" }, 403);
  if (m === "track.getSimilar") {
    const seed = tracks.find((t) => norm(t.artist) === norm(p.get("artist")));
    if (!seed || norm(p.get("track")).startsWith("unknown")) return json({ error: 6, message: "Track not found" }, 404);
    const same = tracks.filter((t) => t.genre === seed.genre && !/slowed|sped/i.test(t.name) && norm(t.name) !== norm(p.get("track")));
    // Last.fm sometimes knows songs Spotify doesn't have
    const list = [...same, { name: "Song Not On Spotify", artist: seed.artist }];
    return json({ similartracks: { track: pick(list).slice(0, +p.get("limit") || 100) } });
  }
  if (m === "artist.getSimilar") {
    const a = ARTISTS.find(([x]) => norm(x) === norm(p.get("artist")));
    if (!a) return json({ error: 6, message: "Artist not found" }, 404);
    return json({ similarartists: { artist: ARTISTS.filter(([x, g]) => g === a[1] && x !== a[0]).map(([x]) => ({ name: x })) } });
  }
  if (m === "artist.getTopTracks") {
    return json({ toptracks: { track: pick(tracks.filter((t) => norm(t.artist) === norm(p.get("artist")) && !/slowed|sped/i.test(t.name))) } });
  }
  if (m === "tag.getTopTracks") {
    const tag = norm(p.get("tag"));
    const list = tracks.filter((t) => norm(t.genre) === tag || (tag === "chill" && t.genre === "lofi"));
    return json({ tracks: { track: pick(list.filter((t) => !/slowed|sped/i.test(t.name))) } });
  }
  return json({ error: 3, message: "Invalid method" }, 400);
}

// ------------------------------------------------------------ Spotify
function search(p) {
  state.searches++;
  if (location.search.includes("mock=quota") && state.searches > state.quotaAfter)
    return json({ error: { status: 429, message: "Quota exceeded", reason: "QUOTA_EXCEEDED" } }, 429, { "Retry-After": "7200" });
  const q = p.get("q");
  const limit = Math.min(10, +p.get("limit") || 5);
  const offset = +p.get("offset") || 0;
  let list;
  const genre = q.match(/^genre:"([^"]+)"$/);
  const field = q.match(/^track:"([^"]*)" artist:"([^"]*)"$/);
  if (genre) list = tracks.filter((t) => norm(t.genre) === norm(genre[1]) && !/slowed|sped/i.test(t.name));
  else if (field) list = tracks.filter((t) => norm(t.name).startsWith(norm(field[1])) && norm(t.artist).includes(norm(field[2])));
  else {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(norm).filter(Boolean);
    list = tracks.filter((t) => words.every((w) => norm(`${t.name} ${t.artist}`).includes(w)));
    if (!list.length) list = tracks.filter((t) => words.some((w) => norm(`${t.name} ${t.artist}`).includes(w)));
  }
  return json({ tracks: { items: list.slice(offset, offset + limit).map(api), total: list.length } });
}

function spotify(u, init) {
  const path = u.pathname.replace(/^\/v1/, "");
  const method = (init?.method || "GET").toUpperCase();
  const p = u.searchParams;
  const body = init?.body ? JSON.parse(init.body) : null;
  if (path === "/search") return search(p);
  if (path === "/me/player" && method === "GET") {
    if (state.noDevice) return new Response(null, { status: 204 });
    return json({ device: state.device, is_playing: true, progress_ms: state.progress, item: state.playing ? api(state.playing) : null });
  }
  if (path === "/me/player/devices") return json({ devices: state.noDevice ? [] : [state.device] });
  if (path === "/me/player/play" && method === "PUT") {
    if (state.noDevice) return json({ error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }, 404);
    state.lastPlay = { uris: body.uris, position_ms: body.position_ms, device: p.get("device_id") };
    state.playing = byId.get(body.uris[0].split(":")[2]);
    state.queue = [];
    return new Response(null, { status: 202 });
  }
  if (path === "/me/player/queue" && method === "POST") {
    state.queue.push(p.get("uri"));
    return new Response(null, { status: 200 });
  }
  if (path === "/me/player/queue" && method === "GET")
    return json({ currently_playing: state.playing ? api(state.playing) : null, queue: state.queue.slice(0, 20).map((uri) => api(byId.get(uri.split(":")[2]))) });
  if (path === "/me/player/recently-played") return json({ items: tracks.slice(5, 9).map((t) => ({ track: api(t) })) });
  if (path.startsWith("/tracks/")) {
    const t = byId.get(path.split("/")[2]);
    return t ? json(api(t)) : json({ error: { status: 404, message: "Not found" } }, 404);
  }
  if (path === "/me/library/contains") return json(p.get("uris").split(",").map((u2) => state.liked.has(u2)));
  if (path === "/me/playlists" && method === "POST") {
    const pl = { id: `mockpl${state.playlists.length}`, name: body.name, public: body.public, items: [] };
    state.playlists.push(pl);
    return json({ id: pl.id, external_urls: { spotify: `https://open.spotify.com/playlist/${pl.id}` } }, 201);
  }
  const m = path.match(/^\/playlists\/([^/]+)\/items$/);
  if (m && method === "POST") {
    state.playlists.find((x) => x.id === m[1]).items.push(...body.uris);
    return json({ snapshot_id: "x" }, 201);
  }
  return json({ error: { status: 404, message: `mock has no ${method} ${path}` } }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url, location.href);
  state.log.push(`${(init?.method || "GET").toUpperCase()} ${u.host}${u.pathname}${u.search}`);
  await new Promise((r) => setTimeout(r, 15));
  if (u.host === "ws.audioscrobbler.com") return lastfm(u);
  if (u.host === "api.spotify.com") return spotify(u, init);
  if (u.host === "accounts.spotify.com")
    return json({ access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, scope: "mock" });
  return realFetch(input, init);
};

// Logged in with fake keys unless the test says otherwise.
if (!location.search.includes("mock=fresh")) {
  localStorage.setItem("vqm:config", JSON.stringify({ clientId: "0123456789abcdef0123456789abcdef", lastfmKey: "fedcba9876543210fedcba9876543210" }));
  if (!localStorage.getItem("vqm:auth"))
    localStorage.setItem("vqm:auth", JSON.stringify({ access: "mock-access", refresh: "mock-refresh", expires: Date.now() + 3e6, scope: "mock" }));
}
