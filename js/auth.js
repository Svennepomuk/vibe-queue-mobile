// Spotify login: Authorization Code with PKCE, all in the browser. No client secret, no backend.
// The Client ID and the Last.fm key are typed into the page once and stay in this browser's storage.

import { load, save } from "./util.js";

const CONFIG_KEY = "vqm:config";
const AUTH_KEY = "vqm:auth";
const PKCE_KEY = "vqm:pkce";

export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-library-read",
  "user-follow-read", // the URI-based library check lists these three scopes
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

export class AuthError extends Error {}

// This page's address without query or "index.html": what Spotify must have as the Redirect URI.
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

export const config = () => load(CONFIG_KEY, {});
export function setConfig(patch) {
  save(CONFIG_KEY, { ...config(), ...patch });
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
function randomString(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CHARS[b % CHARS.length]).join("");
}
export async function challengeOf(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(d)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function login() {
  const { clientId } = config();
  if (!clientId) throw new AuthError("Add your Spotify Client ID first");
  const verifier = randomString(64);
  const state = randomString(16);
  save(PKCE_KEY, { verifier, state });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challengeOf(verifier),
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

// Back from Spotify's login page: trade the code for tokens. Returns true when a login finished.
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return false;
  history.replaceState(null, "", redirectUri() + location.hash);
  const pkce = load(PKCE_KEY, null);
  localStorage.removeItem(PKCE_KEY);
  if (q.has("error"))
    throw new AuthError(q.get("error") === "access_denied" ? "Spotify login cancelled" : `Spotify login failed: ${q.get("error")}`);
  if (!pkce || q.get("state") !== pkce.state) throw new AuthError("That login link expired, connect again");
  await tokenRequest({
    grant_type: "authorization_code",
    code: q.get("code"),
    redirect_uri: redirectUri(),
    client_id: config().clientId,
    code_verifier: pkce.verifier,
  });
  return true;
}

async function tokenRequest(fields) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new AuthError(j.error_description || j.error || `Spotify login failed (${r.status})`);
    e.code = j.error;
    throw e;
  }
  const old = load(AUTH_KEY, {});
  const auth = {
    access: j.access_token,
    refresh: j.refresh_token || old.refresh, // Spotify may hand out a new refresh token; keep the newest
    expires: Date.now() + ((j.expires_in || 3600) - 60) * 1000,
    scope: j.scope || old.scope || "",
  };
  save(AUTH_KEY, auth);
  return auth;
}

let refreshing = null;
export async function accessToken(force = false) {
  const a = load(AUTH_KEY, null);
  if (!a?.refresh && !a?.access) throw new AuthError("Connect Spotify first");
  if (!force && a.access && Date.now() < a.expires) return a.access;
  if (!a.refresh) throw new AuthError("Spotify login expired, connect again");
  refreshing ||= tokenRequest({ grant_type: "refresh_token", refresh_token: a.refresh, client_id: config().clientId })
    .catch((e) => {
      // Refresh tokens end 6 months after the first login, or when access is removed.
      if (e.code === "invalid_grant" || e.code === "invalid_client") {
        logout();
        throw new AuthError("Spotify login expired, connect again");
      }
      throw e;
    })
    .finally(() => (refreshing = null));
  return (await refreshing).access;
}

export const isLoggedIn = () => !!load(AUTH_KEY, null)?.refresh;
export const grantedScopes = () => String(load(AUTH_KEY, {})?.scope || "").split(" ").filter(Boolean);
export function logout() {
  localStorage.removeItem(AUTH_KEY);
}
