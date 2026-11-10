// Spotify Web API calls (development mode, Feb 2026 rules): search returns at most 10 results, the
// library check takes URIs, new playlists go through /me/playlists and songs through /items.

import { accessToken, AuthError } from "./auth.js";
import { load, save, sleep } from "./util.js";

const API = "https://api.spotify.com/v1";

export class QuotaError extends Error {
  constructor(until) {
    const h = Math.max(1, Math.round((until - Date.now()) / 36e5));
    super(`Spotify's search limit is used up. Try again in about ${h} h.`);
    this.until = until;
  }
}
export class NoDeviceError extends Error {
  constructor(msg = "Open Spotify on your phone and play something, then try again.") {
    super(msg);
  }
}
export class ApiError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

// ------------------------------------------------------------ usage counters and the search block
// Spotify doesn't publish the development-mode quota. Searches are counted per day so the limit can
// be learned, and a QUOTA_EXCEEDED answer blocks searching locally until Spotify's wait is over.
const STATS_KEY = "vqm:stats";
const QUOTA_KEY = "vqm:quota";
const today = () => new Date().toLocaleDateString("en-CA");
export function stats() {
  const s = load(STATS_KEY, {});
  return s.day === today() ? s : { day: today(), search: 0, calls: 0 };
}
function count(isSearch) {
  const s = stats();
  s.calls = (s.calls || 0) + 1;
  if (isSearch) s.search = (s.search || 0) + 1;
  save(STATS_KEY, s);
}
export function searchBlockedUntil() {
  const until = load(QUOTA_KEY, {}).search || 0;
  return until > Date.now() ? until : 0;
}
function blockSearch(seconds) {
  const until = Date.now() + (seconds > 0 ? seconds : 3600) * 1000;
  save(QUOTA_KEY, { search: until, seenRetryAfter: seconds || null, at: Date.now() });
  return until;
}

// Spaces calls out so a long mix doesn't trip the 30-second rate limit.
let lastCall = 0;
async function pace(gap) {
  const wait = lastCall + gap - Date.now();
  lastCall = Math.max(Date.now(), lastCall + gap);
  if (wait > 0) await sleep(wait);
}

export async function api(path, { method = "GET", query, body } = {}) {
  const isSearch = path === "/search";
  if (isSearch) {
    const until = searchBlockedUntil();
    if (until) throw new QuotaError(until);
  }
  const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  let force = false;
  for (let attempt = 0; ; attempt++) {
    await pace(isSearch ? 220 : 90);
    const token = await accessToken(force);
    force = false;
    count(isSearch);
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt < 2) {
        await sleep(1000);
        continue;
      }
      throw new ApiError(0, "No connection to Spotify");
    }
    if (r.ok) {
      const text = await r.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null; // some player calls answer with an empty or plain-text body
      }
    }
    let j = {};
    try {
      j = await r.json();
    } catch {}
    const reason = j?.error?.reason || j?.reason || "";
    const msg = j?.error?.message || j?.error_description || "";
    const retryAfter = Number(r.headers.get("Retry-After")) || 0;

    if (r.status === 401 && attempt === 0) {
      force = true;
      continue;
    }
    if (r.status === 429) {
      if (reason === "QUOTA_EXCEEDED" || retryAfter > 120) {
        if (isSearch) throw new QuotaError(blockSearch(retryAfter));
        throw new ApiError(429, "Spotify's limit for this app is used up for now. Try again later.", "QUOTA_EXCEEDED");
      }
      if (attempt < 4) {
        await sleep((retryAfter || 2 ** attempt) * 1000 + 300);
        continue;
      }
      throw new ApiError(429, "Spotify is busy, try again in a minute");
    }
    if (r.status >= 500 && attempt < 2) {
      await sleep(1200);
      continue;
    }
    if (r.status === 404 && /NO_ACTIVE_DEVICE/.test(reason)) throw new NoDeviceError();
    if (r.status === 403 && /PREMIUM_REQUIRED/.test(reason)) throw new ApiError(403, "This needs Spotify Premium", reason);
    if (r.status === 403 && /regist|dashboard|allowlist/i.test(msg))
      throw new ApiError(403, "This Spotify account isn't on the app's user list (Dashboard > User Management).", reason);
    if (r.status === 401) throw new AuthError("Spotify login expired, connect again");
    throw new ApiError(r.status, msg ? `Spotify: ${msg}` : `Spotify error ${r.status}`, reason);
  }
}

// ------------------------------------------------------------ tracks
function pickImage(images, wantWidth) {
  const list = (images || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return (list.find((i) => (i.width || 0) >= wantWidth) || list.at(-1))?.url || "";
}
export function toTrack(d) {
  if (!d?.uri?.startsWith("spotify:track:")) return null;
  return {
    uri: d.uri,
    name: d.name || "",
    artists: (d.artists || []).map((a) => a.name).filter(Boolean).join(", "),
    image: pickImage(d.album?.images, 60),
    art: pickImage(d.album?.images, 250),
  };
}

export async function searchPage(q, limit = 10, offset = 0) {
  const r = await api("/search", { query: { q, type: "track", limit: String(limit), offset: String(offset), market: "from_token" } });
  const items = (r?.tracks?.items || []).filter((d) => d && d.is_playable !== false).map(toTrack).filter(Boolean);
  return { items, total: r?.tracks?.total || 0 };
}
export const searchTracks = async (q, limit = 10) => (await searchPage(q, limit)).items;

export async function getTrack(id) {
  return toTrack(await api(`/tracks/${id}`, { query: { market: "from_token" } }));
}

// ------------------------------------------------------------ player
export async function getPlayer() {
  return api("/me/player", { query: { additional_types: "track" } }); // null when nothing is active
}
export async function getDevices() {
  return (await api("/me/player/devices"))?.devices || [];
}

// The device to play on: the active one, else a phone that's online, else any.
export async function pickDevice() {
  const st = await getPlayer().catch(() => null);
  if (st?.device?.id && !st.device.is_restricted) return { device: st.device, state: st };
  const list = (await getDevices()).filter((d) => d.id && !d.is_restricted);
  const device = list.find((d) => d.is_active) || list.find((d) => /smartphone/i.test(d.type)) || list[0];
  if (!device) throw new NoDeviceError();
  return { device, state: st };
}

export async function playUris(uris, { deviceId, positionMs } = {}) {
  await api("/me/player/play", {
    method: "PUT",
    query: deviceId ? { device_id: deviceId } : undefined,
    body: { uris, ...(positionMs > 0 ? { position_ms: Math.round(positionMs) } : {}) },
  });
}
export async function addToQueue(uri, deviceId) {
  await api("/me/player/queue", { method: "POST", query: { uri, ...(deviceId ? { device_id: deviceId } : {}) } });
}

// ------------------------------------------------------------ library
// Which of these songs are in Liked Songs.
export async function likedSet(uris) {
  const out = new Set();
  for (let i = 0; i < uris.length; i += 40) {
    const chunk = uris.slice(i, i + 40);
    let res;
    try {
      res = await api("/me/library/contains", { query: { uris: chunk.join(",") } });
    } catch (e) {
      if (!(e instanceof ApiError) || ![400, 404].includes(e.status)) throw e;
      // Older apps still have the id-based check.
      res = await api("/me/tracks/contains", { query: { ids: chunk.map((u) => u.split(":")[2]).join(",") } });
    }
    chunk.forEach((u, j) => res?.[j] && out.add(u));
  }
  return out;
}

let recentCache = null;
export async function recentUris() {
  if (recentCache && Date.now() - recentCache.at < 120000) return recentCache.uris;
  const r = await api("/me/player/recently-played", { query: { limit: "50" } });
  const uris = new Set((r?.items || []).map((i) => i?.track?.uri).filter(Boolean));
  recentCache = { at: Date.now(), uris };
  return uris;
}

export async function createPlaylist(name, uris) {
  const p = await api("/me/playlists", {
    method: "POST",
    body: { name, public: false, description: "Made with Vibe Queue" },
  });
  if (!p?.id) throw new ApiError(0, "Spotify didn't create the playlist");
  for (let i = 0; i < uris.length; i += 100)
    await api(`/playlists/${p.id}/items`, { method: "POST", body: { uris: uris.slice(i, i + 100) } });
  return { id: p.id, url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}` };
}
