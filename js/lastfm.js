// Last.fm API (non-commercial use, needs only an API key): similar tracks, similar artists, an
// artist's top tracks and a tag's top tracks. Answers are kept in memory for the session.

import { config } from "./auth.js";
import { sleep } from "./util.js";

const LFM = "https://ws.audioscrobbler.com/2.0/";
const cache = new Map();

export class LastfmError extends Error {}

let lastCall = 0;
async function pace() {
  const wait = lastCall + 220 - Date.now();
  lastCall = Math.max(Date.now(), lastCall + 220);
  if (wait > 0) await sleep(wait);
}

async function call(method, params) {
  const key = config().lastfmKey;
  if (!key) throw new LastfmError("Add your Last.fm API key in Settings");
  const url = `${LFM}?${new URLSearchParams({ method, ...params, api_key: key, format: "json" })}`;
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    await pace();
    let r;
    try {
      r = await fetch(url);
    } catch {
      throw new LastfmError("No connection to Last.fm");
    }
    const j = await r.json().catch(() => null);
    if (j?.error) {
      if (j.error === 6) return null; // not found
      if (j.error === 10 || j.error === 26) throw new LastfmError("Last.fm says the API key isn't valid");
      if (j.error === 29) throw new LastfmError("Last.fm is busy, try again in a minute");
      throw new LastfmError(`Last.fm: ${j.message || j.error}`);
    }
    if (!r.ok || !j) throw new LastfmError(`Last.fm error ${r.status}`);
    return j;
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

// Last.fm gives a single object instead of a list when there's one result.
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const toCand = (t) => ({ name: String(t?.name || ""), artist: String(t?.artist?.name || t?.artist?.["#text"] || t?.artist || "") });
const ok = (c) => c.name && c.artist;

export async function similarTracks(artist, track, limit = 100) {
  const j = await call("track.getSimilar", { artist, track, limit: String(limit), autocorrect: "1" });
  return list(j?.similartracks?.track).map(toCand).filter(ok);
}

export async function similarArtists(artist, limit = 15) {
  const j = await call("artist.getSimilar", { artist, limit: String(limit), autocorrect: "1" });
  return list(j?.similarartists?.artist).map((a) => String(a?.name || "")).filter(Boolean);
}

export async function artistTop(artist, limit = 10) {
  const j = await call("artist.getTopTracks", { artist, limit: String(limit), autocorrect: "1" });
  return list(j?.toptracks?.track).map(toCand).filter(ok);
}

export async function tagTop(tag, limit = 150, page = 1) {
  const j = await call("tag.getTopTracks", { tag, limit: String(limit), page: String(page) });
  return list(j?.tracks?.track).map(toCand).filter(ok);
}
