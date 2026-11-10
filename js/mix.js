// Builds the mixes: similar songs (Last.fm, found on Spotify by search), genres (Spotify's genre
// filter, then Last.fm tags), blends, version swaps and the new-songs-only filter. Then plays them
// or adds them to the queue on the active device.

import * as sp from "./spotify.js";
import * as lfm from "./lastfm.js";
import {
  DAY,
  load,
  save,
  norm,
  shuffle,
  firstArtist,
  baseTitle,
  coreTitle,
  songKey,
  interleave,
  VERSION_RE,
  plural,
} from "./util.js";

// ------------------------------------------------------------ settings
const SETTINGS_KEY = "vqm:settings";
export const settings = {
  count: 25,
  newOnly: false,
  version: "off", // "off" | "slowed" | "spedup"
  recentGenres: [],
  tab: "song",
  ...load(SETTINGS_KEY, {}),
};
export const saveSettings = () => save(SETTINGS_KEY, settings);

// ------------------------------------------------------------ progress and Stop
export class StopError extends Error {
  constructor() {
    super("Stopped");
  }
}
let report = () => {};
export const onProgress = (fn) => (report = fn);
let stopped = false;
export const stop = () => (stopped = true);
const checkStop = () => {
  if (stopped) throw new StopError();
};
function begin() {
  stopped = false;
}

// ------------------------------------------------------------ saved lookups
// Every Last.fm song found (or not found) on Spotify is remembered, so a song costs one search once.
const MATCH_KEY = "vqm:match";
const VARIANT_KEY = "vqm:variant";
const MISS_DAYS = 30;
const matches = load(MATCH_KEY, {});
const variants = load(VARIANT_KEY, {});
let flushTimer = 0;
const slim = (t) => (t ? { uri: t.uri, name: t.name, artists: t.artists, image: t.image } : 0);
function remember(store, key, t) {
  store[key] = [Date.now(), slim(t)];
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushCaches, 1500);
}
function trim(store, max) {
  const entries = Object.entries(store);
  if (entries.length <= max) return;
  entries.sort((a, b) => b[1][0] - a[1][0]);
  for (const [k] of entries.slice(max)) delete store[k];
}
export function flushCaches() {
  trim(matches, 4000);
  trim(variants, 2000);
  save(MATCH_KEY, matches);
  save(VARIANT_KEY, variants);
}
function cached(store, key) {
  const hit = store[key];
  if (!hit) return undefined;
  if (hit[1]) return hit[1];
  return Date.now() - hit[0] < MISS_DAYS * DAY ? null : undefined;
}
export const cacheSize = () => Object.keys(matches).length;
export function clearCaches() {
  for (const store of [matches, variants]) for (const k of Object.keys(store)) delete store[k];
  flushCaches();
}

// ------------------------------------------------------------ finding a Last.fm song on Spotify
const ODD_VERSION = /\b(live|karaoke|instrumental|acapella|a cappella|remix|slowed|sped\s*up|speed\s*up|nightcore|reverb|8d|cover|tribute|lullaby|ringtone)\b/i;

// The search result that is this song: same title (ignoring brackets, "- Remastered" and the like)
// and the same artist. Live, remix, karaoke and similar versions only when that's what was asked for.
export function pickMatch(found, c) {
  const wantCore = coreTitle(c.name);
  const wantArtist = norm(c.artist);
  const wantOdd = ODD_VERSION.test(c.name);
  let best = null;
  let bestScore = 0;
  found.forEach((f, i) => {
    const parts = String(f.artists).split(",").map(norm).filter(Boolean);
    const all = norm(f.artists);
    const artistScore = parts.includes(wantArtist)
      ? 2
      : all.includes(wantArtist) || parts.some((a) => a.length > 2 && wantArtist.includes(a))
        ? 1
        : 0;
    if (!artistScore) return;
    const core = coreTitle(f.name);
    const titleScore =
      core === wantCore ? 2 : Math.min(core.length, wantCore.length) >= 4 && (core.startsWith(wantCore) || wantCore.startsWith(core)) ? 1 : 0;
    if (!titleScore) return;
    let score = artistScore + titleScore * 2 - i * 0.05;
    if (!wantOdd && ODD_VERSION.test(f.name)) score -= 2.5;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  });
  return bestScore >= 2.5 ? best : null;
}

// A Last.fm song { name, artist } on Spotify, or null. Uses only saved lookups while Spotify's search
// limit is used up.
export async function findOnSpotify(c) {
  const key = `${norm(c.artist)}|${norm(c.name)}`;
  const hit = cached(matches, key);
  if (hit !== undefined) return hit;
  if (sp.searchBlockedUntil()) return null;
  const title = (baseTitle(c.name) || c.name).replace(/"/g, "");
  const artist = c.artist.replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, "").replace(/"/g, "");
  let t = null;
  try {
    const found = await sp.searchTracks(`track:"${title}" artist:"${artist}"`, 5);
    t = pickMatch(found, c);
    if (!t && !found.length) t = pickMatch(await sp.searchTracks(`${title} ${artist}`, 5), c);
  } catch (e) {
    if (e instanceof sp.QuotaError) return null; // not saved as a miss: it may be on Spotify
    throw e;
  }
  remember(matches, key, t);
  return t;
}

// ------------------------------------------------------------ choosing songs
// A mix in the making: what's already in it or excluded (`seen`, by URI and by song), songs you
// picked yourself (`keep`, never filtered out), and how many songs each artist has.
function newMix({ exclude = [], keep = [] } = {}) {
  const seen = new Set();
  for (const t of exclude) {
    if (!t) continue;
    if (t.uri) seen.add(t.uri);
    if (t.name) seen.add(songKey(t));
  }
  return { seen, keep: new Set(keep), perArtist: new Map(), cap: Math.max(2, Math.ceil(settings.count / 10)) };
}

const isSeen = (mix, t) => mix.seen.has(t.uri) || mix.seen.has(songKey(t));
function take(mix, t) {
  const a = norm(firstArtist(t));
  mix.perArtist.set(a, (mix.perArtist.get(a) || 0) + 1);
  mix.seen.add(t.uri);
  mix.seen.add(songKey(t));
}
const artistFull = (mix, name) => (mix.perArtist.get(norm(name)) || 0) >= mix.cap;

// "New songs only": drops Liked Songs and your last 50 plays (songs you picked stay).
async function keepNew(tracks, mix) {
  if (!settings.newOnly || !tracks.length) return tracks;
  const check = tracks.filter((t) => !mix.keep.has(t.uri)).map((t) => t.uri);
  const [liked, recent] = await Promise.all([sp.likedSet(check), sp.recentUris().catch(() => new Set())]);
  return tracks.filter((t) => mix.keep.has(t.uri) || !(liked.has(t.uri) || recent.has(t.uri)));
}

// Adds Spotify tracks to `out` (up to `need`) that pass the filters.
async function accept(tracks, need, mix, out) {
  const fresh = tracks.filter((t) => !isSeen(mix, t));
  for (const t of await keepNew(fresh, mix)) {
    if (out.length >= need) break;
    if (isSeen(mix, t) || artistFull(mix, firstArtist(t))) continue;
    take(mix, t);
    out.push(t);
  }
}

// Finds Last.fm candidates on Spotify, in order, until `need` songs pass the filters. Only searches as
// many as it still needs, plus a couple for misses.
async function collect(cands, need, mix) {
  const out = [];
  const tried = new Set();
  let i = 0;
  while (out.length < need && i < cands.length) {
    checkStop();
    const batch = [];
    const pending = new Map(); // songs per artist in this batch, so the artist cap holds before searching
    const skipped = [];
    while (batch.length < need - out.length + 2 && i < cands.length) {
      const c = cands[i++];
      const k = songKey({ name: c.name, artists: c.artist });
      if (tried.has(k) || mix.seen.has(k)) continue;
      const a = norm(c.artist);
      if ((mix.perArtist.get(a) || 0) + (pending.get(a) || 0) >= mix.cap) {
        if (!artistFull(mix, c.artist)) skipped.push(c); // may fit later if a search misses
        continue;
      }
      pending.set(a, (pending.get(a) || 0) + 1);
      tried.add(k);
      batch.push(c);
    }
    if (!batch.length) break;
    // Songs held back for the artist cap get another chance in the next round.
    cands.splice(i, 0, ...skipped);
    const found = [];
    for (const c of batch) {
      checkStop();
      const t = await findOnSpotify(c);
      if (t) found.push(t);
      report(`Finding songs on Spotify ${Math.min(need, out.length + found.length)}/${need}`);
    }
    await accept(found, need, mix, out);
  }
  return out;
}

// Light shuffle: keeps Last.fm's order roughly (most similar first) but varies the mix each time.
function looseShuffle(list, block = 8) {
  const out = [];
  for (let i = 0; i < list.length; i += block) out.push(...shuffle(list.slice(i, i + block)));
  return out;
}

async function similarCandidates(seed, need) {
  const artist = firstArtist(seed);
  report("Asking Last.fm for similar songs");
  let cands = await lfm.similarTracks(artist, baseTitle(seed.name), 100).catch((e) => {
    if (e instanceof lfm.LastfmError && /key|connection/i.test(e.message)) throw e;
    return [];
  });
  if (cands.length < need * 2) {
    // Few similar songs on Last.fm (new or niche songs): add top songs of similar artists.
    const others = (await lfm.similarArtists(artist, 12).catch(() => [])).slice(0, 10);
    const tops = await Promise.all([artist, ...others].map((a) => lfm.artistTop(a, 6).catch(() => [])));
    const own = tops.shift();
    cands = cands.concat(interleave([...tops.slice(0, 1), own, ...tops.slice(1)], (c) => `${norm(c.artist)}|${norm(c.name)}`));
  }
  if (!cands.length) throw new Error("Last.fm doesn't know this song or its artist yet");
  return looseShuffle(cands);
}

// Songs like `seed` (not the seed itself).
async function similarSongs(seed, need, mix) {
  mix.seen.add(seed.uri);
  mix.seen.add(songKey(seed));
  const cands = await similarCandidates(seed, need);
  return collect(cands, need, mix);
}

// Last.fm's top songs for a tag, trying "hip hop", "hip-hop" and "hiphop".
async function tagCandidates(genre) {
  const g = genre.trim().toLowerCase();
  const tries = [...new Set([g, g.replace(/\s+/g, "-"), g.replace(/-/g, " "), g.replace(/[\s-]+/g, "")])];
  let best = [];
  for (const t of tries) {
    const list = await lfm.tagTop(t, 150).catch((e) => {
      if (/key|connection/i.test(e.message)) throw e;
      return [];
    });
    if (list.length > best.length) best = list;
    if (best.length >= 50) break;
  }
  return shuffle(best);
}

// A genre: Spotify's genre filter first (10 songs per search, nothing to match), random pages from its
// top 200 so it changes each time; then Last.fm's tag for what's still missing (moods like "chill"
// or "sad" are Last.fm tags, not Spotify genres).
async function genreSongs(genre, need, mix) {
  const out = [];
  report(`Looking for ${genre}`);
  try {
    const q = `genre:"${genre.replace(/"/g, "")}"`;
    const first = await sp.searchPage(q, 10, 0);
    if (first.total >= 5) {
      const pages = Math.min(Math.ceil(first.total / 10), 20);
      const offsets = shuffle([...Array(pages).keys()].slice(1)).map((p) => p * 10);
      await accept(shuffle(first.items), need, mix, out);
      for (const offset of offsets) {
        if (out.length >= need) break;
        checkStop();
        report(`Finding ${genre} songs ${out.length}/${need}`);
        await accept(shuffle((await sp.searchPage(q, 10, offset)).items), need, mix, out);
      }
    }
  } catch (e) {
    if (!(e instanceof sp.QuotaError)) throw e;
  }
  if (out.length < need) {
    report("Asking Last.fm");
    const cands = await tagCandidates(genre);
    out.push(...(await collect(cands, need - out.length, mix)));
  }
  return shuffle(out);
}

// ------------------------------------------------------------ versions
// The slowed / sped up version of a song, or null: same title and one of the same artists (re-uploads
// by unrelated accounts too often turn out to be a different song).
async function variantOf(t, kind) {
  const key = `${kind}|${t.uri}`;
  const hit = cached(variants, key);
  if (hit !== undefined) return hit;
  if (sp.searchBlockedUntil()) return null;
  const re = VERSION_RE[kind];
  const core = coreTitle(t.name);
  const names = String(t.artists).split(",").map(norm).filter(Boolean);
  let best = null;
  try {
    const found = await sp.searchTracks(`${baseTitle(t.name)} ${firstArtist(t)} ${kind === "slowed" ? "slowed" : "sped up"}`, 10);
    best = found.find((f) => f.uri !== t.uri && re.test(f.name) && coreTitle(f.name) === core && names.some((a) => norm(f.artists).includes(a))) || null;
  } catch (e) {
    if (e instanceof sp.QuotaError) return null;
    throw e;
  }
  remember(variants, key, best);
  return best;
}

// Swaps songs for their version if the Versions setting is on, then drops duplicates.
async function finish(list) {
  const kind = settings.version;
  let out = list;
  if (VERSION_RE[kind]) {
    out = list.slice();
    const label = kind === "slowed" ? "slowed" : "sped up";
    for (let i = 0; i < list.length; i++) {
      checkStop();
      report(`Finding ${label} versions ${i + 1}/${list.length}`);
      if (!VERSION_RE[kind].test(list[i].name)) out[i] = (await variantOf(list[i], kind)) || list[i];
    }
  }
  const seen = new Set();
  return out.filter((t) => !seen.has(t.uri) && seen.add(t.uri));
}

// ------------------------------------------------------------ the last mix (for Save)
const MIX_KEY = "vqm:mix";
export let lastMix = load(MIX_KEY, null); // { name, uris, at, saved }
let mixListeners = [];
export const onMix = (fn) => mixListeners.push(fn);
function setMix(name, tracks, append = false) {
  const uris = tracks.map((t) => t.uri);
  const recent = lastMix && Date.now() - lastMix.at < 12 * 36e5;
  if (append && recent) lastMix = { ...lastMix, uris: [...new Set([...lastMix.uris, ...uris])], at: Date.now(), saved: null };
  else lastMix = { name, uris, at: Date.now(), saved: null };
  save(MIX_KEY, lastMix);
  mixListeners.forEach((fn) => fn(lastMix));
}

// ------------------------------------------------------------ playing and queueing
async function device() {
  report("Checking your Spotify");
  return sp.pickDevice();
}

// What's playing and coming up, so Add doesn't repeat it.
async function upcoming() {
  const q = await sp.api("/me/player/queue").catch(() => null);
  const list = [q?.currently_playing, ...(q?.queue || [])].map(sp.toTrack).filter(Boolean);
  if (lastMix && Date.now() - lastMix.at < 12 * 36e5) list.push(...lastMix.uris.map((uri) => ({ uri })));
  return list;
}

async function needsPlaying() {
  const { device: d, state } = await device();
  if (!state?.device?.is_active || !state?.item) throw new sp.NoDeviceError("Nothing is playing. Use Play, or start Spotify first.");
  return d;
}

async function playList(list) {
  const { device: d } = await device();
  // The seed keeps playing where it is if it's the song on right now.
  const st = await sp.getPlayer().catch(() => null);
  const pos = st?.item?.uri && st.item.uri === list[0].uri ? st.progress_ms : 0;
  report("Starting");
  await sp.playUris(list.map((t) => t.uri), { deviceId: d.id, positionMs: pos });
}

async function queueAll(list, deviceId, name) {
  let added = 0;
  try {
    for (const t of list) {
      checkStop();
      report(`Adding to queue ${added + 1}/${list.length}`);
      await sp.addToQueue(t.uri, deviceId);
      added++;
    }
  } finally {
    if (added) setMix(name, list.slice(0, added), true);
  }
  return added;
}

const searchNote = () => (sp.searchBlockedUntil() ? " (Spotify's search limit is reached, so fewer songs)" : "");
function nothingFound(what) {
  const until = sp.searchBlockedUntil();
  if (until) throw new sp.QuotaError(until);
  throw new Error(`Found no ${what} on Spotify`);
}

export async function playSimilar(seed) {
  begin();
  await device(); // fail early when no Spotify is open
  const mix = newMix({ keep: [seed.uri] });
  const songs = await similarSongs(seed, settings.count, mix);
  if (!songs.length) nothingFound("similar songs");
  const list = await finish([seed, ...songs]);
  await playList(list);
  setMix(`Songs like ${seed.name}`, list);
  return `Playing ${seed.name} and ${plural(list.length - 1, "similar song")}${searchNote()}`;
}

export async function addSimilar(seed) {
  begin();
  const d = await needsPlaying();
  const mix = newMix({ exclude: [seed, ...(await upcoming())] });
  const songs = await finish(await similarSongs(seed, settings.count, mix));
  if (!songs.length) nothingFound("new similar songs");
  const n = await queueAll(songs, d.id, `Songs like ${seed.name}`);
  return `Added ${plural(n, "song")} like ${seed.name}${searchNote()}`;
}

function rememberGenre(genre) {
  const g = genre.trim().toLowerCase();
  settings.recentGenres = [g, ...settings.recentGenres.filter((x) => x !== g)].slice(0, 8);
  saveSettings();
}

export async function playGenre(genre) {
  begin();
  await device();
  const songs = await genreSongs(genre, settings.count, newMix());
  if (!songs.length) nothingFound(`${genre} songs`);
  const list = await finish(songs);
  await playList(list);
  rememberGenre(genre);
  setMix(`${genre} mix`, list);
  return `Playing ${plural(list.length, `${genre} song`)}${searchNote()}`;
}

export async function addGenre(genre) {
  begin();
  const d = await needsPlaying();
  const songs = await finish(await genreSongs(genre, settings.count, newMix({ exclude: await upcoming() })));
  if (!songs.length) nothingFound(`new ${genre} songs`);
  const n = await queueAll(songs, d.id, `${genre} mix`);
  rememberGenre(genre);
  return `Added ${plural(n, `${genre} song`)}${searchNote()}`;
}

// ------------------------------------------------------------ blend
// Two or three songs and/or genres, taking turns. A part is { kind: "song", track } or
// { kind: "genre", genre }.
export const blendLabel = (p) => (p.kind === "song" ? p.track.name || "a song" : p.genre);

async function blendSongs(parts, exclude = []) {
  const picked = parts.filter((p) => p.kind === "song").map((p) => p.track);
  const mix = newMix({ exclude, keep: picked.map((t) => t.uri) });
  for (const t of picked) take(mix, t); // the picked songs themselves come first in their turn
  const per = Math.ceil(settings.count / parts.length);
  const lists = [];
  for (const p of parts) {
    checkStop();
    if (p.kind === "song") {
      const list = await similarSongs(p.track, per, mix);
      if (!exclude.some((t) => t.uri === p.track.uri)) list.unshift(p.track);
      lists.push(list);
    } else lists.push(await genreSongs(p.genre, per, mix));
  }
  return finish(interleave(lists));
}

export async function playBlend(parts) {
  begin();
  await device();
  const list = await blendSongs(parts);
  if (!list.length) nothingFound("songs for this blend");
  await playList(list);
  const name = parts.map(blendLabel).join(" + ");
  setMix(name, list);
  return `Playing a blend of ${name}${searchNote()}`;
}

export async function addBlend(parts) {
  begin();
  const d = await needsPlaying();
  const list = await blendSongs(parts, await upcoming());
  if (!list.length) nothingFound("new songs for this blend");
  const name = parts.map(blendLabel).join(" + ");
  const n = await queueAll(list, d.id, name);
  return `Added a blend of ${name} (${plural(n, "song")})`;
}

// ------------------------------------------------------------ save as playlist
export async function saveMix() {
  begin();
  if (!lastMix?.uris?.length) throw new Error("Play or add a mix first");
  const day = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const name = `${lastMix.name} · ${day}`;
  report("Saving");
  const p = await sp.createPlaylist(name, lastMix.uris.slice(0, 1000));
  lastMix = { ...lastMix, saved: p.url };
  save(MIX_KEY, lastMix);
  mixListeners.forEach((fn) => fn(lastMix));
  return `Saved ${plural(lastMix.uris.length, "song")} as "${name}"`;
}

// ------------------------------------------------------------ search box
const searchCache = new Map();
export async function searchSongs(q) {
  const key = q.trim().toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);
  const res = await sp.searchTracks(q, 10);
  searchCache.set(key, res);
  return res;
}
