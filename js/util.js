// Small helpers shared by the page. Title matching and dedupe follow the desktop extension
// (vibe-queue\vibeQueue.js), with one change: norm() keeps letters of every script, so Cyrillic,
// Japanese or Korean titles still compare.

export const DAY = 864e5;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const firstArtist = (t) => String(t.artists || t.artist || "").split(",")[0].trim();

// "Leanin - Slowed" / "Leanin (Slowed + Reverb)" / "Leanin feat. X" -> "Leanin"
export const baseTitle = (name) =>
  String(name || "")
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/\s+[-–—]\s+.*$/, "")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
    .trim() || String(name || "");

export const VERSION_RE = { slowed: /slowed/i, spedup: /sped\s*up|speed\s*up|nightcore/i };
const VERSION_WORDS = /\b(?:slowed|reverb|sped\s*up|speed\s*up|nightcore)\b/gi;

// "Leanin (Slowed + Reverb)" / "Leanin slowed" -> "leanin"
export const coreTitle = (name) => norm(baseTitle(name).replace(VERSION_WORDS, "")) || norm(name);

// One key per song, whatever the version: "Leanin - Slowed" and "Leanin" by the same artist match.
export const songKey = (t) => `${coreTitle(t.name)}|${norm(firstArtist(t))}`;

// Takes turns between lists: a1, b1, a2, b2, ... without duplicates.
export function interleave(lists, key = (t) => t.uri) {
  const out = [];
  const seen = new Set();
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) {
      const t = l[i];
      if (!t) continue;
      const k = key(t);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  return out;
}

// A Spotify link or URI anywhere in a text -> { kind, id }, kind being track, album, artist, playlist...
export function findSpotifyLink(text) {
  const m = String(text || "").match(
    /(?:spotify:|open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?)(track|album|artist|playlist|episode|show)[:/]([A-Za-z0-9]{22})/
  );
  return m ? { kind: m[1], id: m[2] } : null;
}

// Spotify's short share links (spotify.link/..., spotify.app.link/...).
export function findShortLink(text) {
  const m = String(text || "").match(/https?:\/\/spotify\.(?:app\.)?link\/[A-Za-z0-9_-]+(?:\?[^\s]*)?/);
  return m ? m[0] : null;
}

// A pasted or shared song link -> the track id.
export function linkToId(text) {
  const link = findSpotifyLink(text);
  return link?.kind === "track" ? link.id : null;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
