// The page: setup, the Song / Genre / Blend tabs, the status bar, Save, and Settings.

import * as auth from "./auth.js";
import * as sp from "./spotify.js";
import * as mix from "./mix.js";
import { findShortLink, findSpotifyLink, plural } from "./util.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const STARTER_GENRES = ["pop", "hip hop", "phonk", "lofi", "rock", "edm"];
const settings = mix.settings;

// ------------------------------------------------------------ status, toast
const statusBox = $("[data-status]");
const statusText = $("[data-status-text]");
const toastBox = $("[data-toast]");
let toastTimer = 0;

function setStatus(text) {
  statusBox.hidden = !text;
  if (text) {
    statusText.textContent = text;
    toastBox.hidden = true;
  }
}
function toast(msg, isError = false) {
  clearTimeout(toastTimer);
  toastBox.textContent = msg;
  toastBox.classList.toggle("error", isError);
  toastBox.hidden = false;
  toastTimer = setTimeout(() => (toastBox.hidden = true), isError ? 8000 : 4500);
}
toastBox.addEventListener("click", () => (toastBox.hidden = true));
mix.onProgress((t) => busy && setStatus(t));
$("[data-stop]").onclick = () => {
  mix.stop();
  setStatus("Stopping");
};

// ------------------------------------------------------------ running an action
let busy = false;
async function run(task) {
  if (busy) return false;
  busy = true;
  updateButtons();
  setStatus("Working");
  try {
    const msg = await task();
    setStatus(null);
    if (msg) toast(msg);
    return true;
  } catch (e) {
    setStatus(null);
    showError(e);
    return false;
  } finally {
    busy = false;
    updateButtons();
    setTimeout(refreshNow, 2500);
  }
}

function showError(e) {
  if (e instanceof mix.StopError) return toast("Stopped");
  console.error(e);
  if (e instanceof auth.AuthError && !auth.isLoggedIn()) showView();
  toast(e?.message || String(e), true);
}

// ------------------------------------------------------------ views
function hasKeys() {
  const c = auth.config();
  return !!(c.clientId && c.lastfmKey);
}
function showView() {
  const ready = hasKeys() && auth.isLoggedIn();
  $('[data-view="setup"]').hidden = ready;
  $('[data-view="main"]').hidden = !ready;
  $("[data-open-settings]").hidden = !ready;
  if (ready) {
    showTab(settings.tab);
    refreshNow();
  }
  renderMix(mix.lastMix);
}

// ------------------------------------------------------------ setup and keys
$$("[data-redirect]").forEach((el) => (el.textContent = auth.redirectUri()));
$$("[data-copy]").forEach(
  (b) =>
    (b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(auth.redirectUri());
        toast("Copied");
      } catch {
        toast("Couldn't copy, select it by hand", true);
      }
    })
);

const KEY_RE = /^[0-9a-f]{32}$/i;
function bindKeys() {
  const c = auth.config();
  $$("[data-cfg]").forEach((input) => {
    input.value = c[input.dataset.cfg] || "";
    input.onchange = () => {
      const key = input.dataset.cfg;
      const value = input.value.trim();
      const before = auth.config()[key] || "";
      auth.setConfig({ [key]: value });
      $$(`[data-cfg="${key}"]`).forEach((other) => (other.value = value));
      // A new Client ID is a new app: the old login belongs to the old one.
      if (key === "clientId" && before && before !== value && auth.isLoggedIn()) {
        auth.logout();
        closeSettings();
        showView();
      }
    };
  });
}

$("[data-connect]").onclick = async () => {
  $$('[data-view="setup"] [data-cfg]').forEach((i) => i.onchange());
  const c = auth.config();
  if (!KEY_RE.test(c.clientId || "")) return toast("The Client ID should be 32 letters and numbers", true);
  if (!KEY_RE.test(c.lastfmKey || "")) return toast("The Last.fm API key should be 32 letters and numbers", true);
  try {
    await auth.login();
  } catch (e) {
    showError(e);
  }
};

// ------------------------------------------------------------ tabs
function showTab(tab) {
  if (!["song", "genre", "blend"].includes(tab)) tab = "song";
  settings.tab = tab;
  mix.saveSettings();
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
}
$$("[data-tab]").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ------------------------------------------------------------ rows
function coverDiv(url, cls = "cover") {
  const d = document.createElement("div");
  d.className = cls;
  if (/^https:\/\//.test(url || "")) d.style.backgroundImage = `url("${url.replace(/"/g, "")}")`;
  return d;
}
function makeRow(t, sub, onPick, cover) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  const text = document.createElement("div");
  const title = document.createElement("div");
  title.className = "t";
  title.textContent = t.name;
  const s = document.createElement("div");
  s.className = "s";
  s.textContent = sub;
  text.append(title, s);
  const go = document.createElement("span");
  go.className = "go";
  go.textContent = "Use";
  row.append(cover || coverDiv(t.image), text, go);
  row.onclick = onPick;
  return row;
}
function message(box, text) {
  box.innerHTML = "";
  const d = document.createElement("div");
  d.className = "empty";
  d.textContent = text;
  box.append(d);
}

// Spotify's short links (spotify.link/...) lead to the real song link. On a phone they lead on to the
// Spotify app instead, which a page can't follow, so this often comes back empty there.
async function resolveShortLink(url) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    return findSpotifyLink(res.url) || findSpotifyLink(await res.text());
  } catch {
    return null;
  }
}

const NOT_A_SONG = "That's not a song. Albums, artists and playlists don't work here.";

// Typed words search Spotify. A pasted song link, long or short, looks that song up.
async function lookUp(q) {
  let link = findSpotifyLink(q);
  const short = !link && findShortLink(q);
  if (short && !(link = await resolveShortLink(short)))
    throw new Error("Short spotify.link links don't open here. Share the song to Vibe Queue instead.");
  if (link && link.kind !== "track") throw new Error(NOT_A_SONG);
  if (link) return [await sp.getTrack(link.id)].filter(Boolean);
  return q.length >= 2 ? mix.searchSongs(q) : [];
}

// Search as you type (after a pause) or on Enter.
function liveSearch(input, onResults) {
  let token = 0;
  let timer = 0;
  const go = (now) => {
    clearTimeout(timer);
    const mine = ++token;
    const q = input.value.trim();
    if (!q) return void onResults("", null, null);
    const exec = async () => {
      let res = null;
      let err = null;
      try {
        res = await lookUp(q);
      } catch (e) {
        err = e;
      }
      if (mine === token) onResults(q, res, err);
    };
    if (now) exec();
    else timer = setTimeout(exec, 700);
  };
  input.addEventListener("input", () => go(false));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go(true);
    input.blur();
  });
}

// ------------------------------------------------------------ song tab
let nowTrack = null;
let nowDevice = "";
let picked = null;
const seedTrack = () => picked || nowTrack;

function renderSeed() {
  const t = seedTrack();
  const art = $("[data-seed-art]");
  art.style.backgroundImage = t && /^https:\/\//.test(t.art || t.image || "") ? `url("${(t.art || t.image).replace(/"/g, "")}")` : "";
  $("[data-seed-label]").textContent = picked ? "Picked" : nowDevice ? `Now playing · ${nowDevice}` : "Now playing";
  $("[data-seed-title]").textContent = t ? t.name : "Nothing playing";
  $("[data-seed-artists]").textContent = t ? t.artists : "Play something in Spotify or search below";
  $("[data-seed-clear]").hidden = !picked;
  updateButtons();
}

// One look at the player at a time; callers that come in meanwhile wait for the same answer.
let nowPromise = null;
function refreshNow() {
  if (document.hidden || !auth.isLoggedIn()) return Promise.resolve();
  nowPromise ||= (async () => {
    try {
      const st = await sp.getPlayer();
      nowTrack = sp.toTrack(st?.item);
      nowDevice = st?.device?.name || "";
    } catch (e) {
      if (e instanceof auth.AuthError) showError(e);
    } finally {
      nowPromise = null;
    }
    renderSeed();
  })();
  return nowPromise;
}
$("[data-seed]").onclick = (e) => {
  if (e.target.closest("[data-seed-clear]")) return;
  if (!picked) refreshNow();
};
$("[data-seed-clear]").onclick = () => {
  picked = null;
  renderSeed();
  refreshNow();
};

const songResults = $("[data-song-results]");
liveSearch($("[data-song-q]"), (q, tracks, err) => {
  if (!q) return void (songResults.innerHTML = "");
  if (err) return message(songResults, err.message || "Search failed");
  if (!tracks?.length) return message(songResults, "No songs found");
  songResults.innerHTML = "";
  for (const t of tracks)
    songResults.append(
      makeRow(t, t.artists, () => {
        picked = t;
        renderSeed();
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );
});

// ------------------------------------------------------------ genre tab
const genreInput = $("[data-genre-q]");
genreInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    genreInput.blur();
  }
});
function renderChips() {
  const box = $("[data-genre-chips]");
  box.innerHTML = "";
  for (const g of settings.recentGenres.length ? settings.recentGenres : STARTER_GENRES) {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip";
    c.textContent = g;
    c.onclick = () => (genreInput.value = g);
    box.append(c);
  }
}
function genreValue() {
  const g = genreInput.value.trim();
  if (!g) {
    genreInput.focus();
    throw new Error("Type a genre first");
  }
  return g;
}

// ------------------------------------------------------------ blend tab
const MAX_BLEND = 3;
const parts = [];
const blendInput = $("[data-blend-q]");
const blendResults = $("[data-blend-results]");

function renderSlots() {
  const box = $("[data-slots]");
  box.innerHTML = "";
  const shown = Math.min(MAX_BLEND, Math.max(2, parts.length + 1));
  for (let i = 0; i < shown; i++) {
    const p = parts[i];
    const el = document.createElement("div");
    if (p) {
      el.className = "slot";
      const kind = document.createElement("span");
      kind.className = "slot-kind";
      kind.textContent = p.kind === "song" ? "Song" : "Genre";
      const name = document.createElement("span");
      name.className = "slot-name";
      name.textContent = mix.blendLabel(p);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "icon-btn x";
      x.setAttribute("aria-label", "Remove");
      x.textContent = "×";
      x.onclick = () => {
        parts.splice(i, 1);
        renderSlots();
      };
      el.append(kind, name, x);
    } else {
      el.className = "slot empty-slot";
      el.textContent = i === 0 ? "Pick a song or genre" : i === 1 ? "…and one more" : "…and a third, if you like";
    }
    box.append(el);
  }
  const full = parts.length >= MAX_BLEND;
  blendInput.disabled = full;
  blendInput.placeholder = full ? "Remove one to change the blend" : "Add a song or a genre";
  updateButtons();
}
function useBlend(part) {
  if (parts.length >= MAX_BLEND) return;
  parts.push(part);
  blendInput.value = "";
  blendResults.innerHTML = "";
  renderSlots();
}
liveSearch(blendInput, (q, tracks, err) => {
  blendResults.innerHTML = "";
  if (!q) return;
  if (!findSpotifyLink(q) && !findShortLink(q)) {
    const cover = coverDiv("", "cover genre-cover");
    cover.textContent = "#";
    blendResults.append(makeRow({ name: q }, "Genre", () => useBlend({ kind: "genre", genre: q.toLowerCase() }), cover));
  }
  if (err) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = err.message || "Search failed";
    blendResults.append(d);
  }
  for (const t of tracks || []) blendResults.append(makeRow(t, t.artists, () => useBlend({ kind: "song", track: t })));
});

// ------------------------------------------------------------ actions
const ACTIONS = {
  playSimilar: () => mix.playSimilar(seedTrack()),
  addSimilar: () => mix.addSimilar(seedTrack()),
  playGenre: () => mix.playGenre(genreValue()).finally(renderChips),
  addGenre: () => mix.addGenre(genreValue()).finally(renderChips),
  playBlend: () => mix.playBlend([...parts]),
  addBlend: () => mix.addBlend([...parts]),
};
$$("[data-act]").forEach((b) => (b.onclick = () => run(ACTIONS[b.dataset.act])));

function updateButtons() {
  const has = { playSimilar: !!seedTrack(), addSimilar: !!seedTrack(), playBlend: parts.length >= 2, addBlend: parts.length >= 2 };
  $$("[data-act]").forEach((b) => (b.disabled = busy || has[b.dataset.act] === false));
  $("[data-save]").disabled = busy;
}

// ------------------------------------------------------------ save bar
function renderMix(m) {
  const bar = $("[data-savebar]");
  const ready = hasKeys() && auth.isLoggedIn();
  bar.hidden = !ready || !m?.uris?.length;
  if (bar.hidden) return;
  $("[data-mix-name]").textContent = m.name;
  $("[data-mix-count]").textContent = m.saved ? `${plural(m.uris.length, "song")} · saved` : plural(m.uris.length, "song");
  $("[data-save]").hidden = !!m.saved;
  const open = $("[data-open-playlist]");
  open.hidden = !m.saved;
  if (m.saved) open.href = m.saved;
}
mix.onMix(renderMix);
$("[data-save]").onclick = () => run(mix.saveMix);

// ------------------------------------------------------------ settings
const sheet = $("[data-settings]");
function renderUsage() {
  const s = sp.stats();
  const until = sp.searchBlockedUntil();
  const parts = [`Spotify searches today: ${s.search || 0}`, `Songs remembered: ${mix.cacheSize()}`];
  if (until) parts.unshift(`Search limit reached, back in about ${Math.max(1, Math.round((until - Date.now()) / 36e5))} h`);
  $("[data-usage]").textContent = parts.join(" · ");
}
function closeSettings() {
  if (sheet.open) sheet.close();
}
$("[data-open-settings]").onclick = () => {
  renderUsage();
  bindKeys();
  sheet.showModal();
};
$("[data-close]").onclick = closeSettings;
sheet.addEventListener("click", (e) => {
  const r = sheet.getBoundingClientRect();
  if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) closeSettings();
});
const countSel = $("[data-count]");
countSel.value = String(settings.count);
countSel.onchange = () => {
  settings.count = Number(countSel.value) || 25;
  mix.saveSettings();
};
const newOnly = $("[data-new-only]");
newOnly.checked = !!settings.newOnly;
newOnly.onchange = () => {
  settings.newOnly = newOnly.checked;
  mix.saveSettings();
};
const versionSel = $("[data-version]");
versionSel.value = settings.version;
versionSel.onchange = () => {
  settings.version = versionSel.value;
  mix.saveSettings();
};
$("[data-logout]").onclick = () => {
  auth.logout();
  closeSettings();
  showView();
};

// ------------------------------------------------------------ opened from Spotify's Share menu or a shortcut
// Share: ?title=&text=&url= (manifest share_target). Long-press shortcuts: ?do=play-similar / add-similar.
const LAUNCH_KEYS = ["do", "title", "text", "url"];
function takeLaunch() {
  const p = new URLSearchParams(location.search);
  if (!LAUNCH_KEYS.some((k) => p.has(k))) return null;
  const launch = {
    act: p.get("do"),
    shared: ["title", "text", "url"].map((k) => p.get(k) || "").join(" ").trim(),
  };
  LAUNCH_KEYS.forEach((k) => p.delete(k));
  const rest = p.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  return launch;
}

async function pickShared(text) {
  let link = findSpotifyLink(text);
  const short = !link && findShortLink(text);
  if (short) link = await resolveShortLink(short);
  if (link && link.kind !== "track") throw new Error(NOT_A_SONG);
  if (link) {
    const t = await sp.getTrack(link.id);
    if (!t) throw new Error("Couldn't find that song on Spotify");
    picked = t;
    renderSeed();
    return null;
  }
  // No link the page can read: search the shared words instead, if there are any.
  const words = text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 2) throw new Error("Couldn't open that link. Play the song in Spotify, then tap Play similar.");
  const box = $("[data-song-q]");
  box.value = words;
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  return null;
}

async function handleLaunch(launch) {
  if (!launch || !hasKeys() || !auth.isLoggedIn()) return;
  showTab("song");
  if (launch.shared) return void run(() => pickShared(launch.shared));
  if (launch.act !== "play-similar" && launch.act !== "add-similar") return;
  picked = null;
  await refreshNow();
  if (!nowTrack) return toast("Play something in Spotify first", true);
  run(launch.act === "play-similar" ? ACTIONS.playSimilar : ACTIONS.addSimilar);
}

// ------------------------------------------------------------ start
document.addEventListener("visibilitychange", () => {
  if (document.hidden) mix.flushCaches();
  else refreshNow();
});
window.addEventListener("pagehide", () => mix.flushCaches());
setInterval(() => {
  if (!document.hidden && !busy && !picked) refreshNow();
}, 30000);

async function start() {
  const launch = takeLaunch();
  if (location.hostname === "127.0.0.1" && new URLSearchParams(location.search).has("mock")) {
    await import("../dev/mock.js");
    window.__vqm = { mix, sp, auth };
  }
  bindKeys();
  renderChips();
  renderSlots();
  renderSeed();
  try {
    if (await auth.finishLogin()) toast("Connected to Spotify");
  } catch (e) {
    showError(e);
  }
  showView();
  handleLaunch(launch);
  if ("serviceWorker" in navigator && !location.search.includes("mock")) navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
