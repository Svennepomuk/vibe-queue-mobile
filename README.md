# Vibe Queue Mobile

A web page for Spotify on your phone, because Spotify's phone app can't load extensions. It brings the main Vibe Queue features over, using Spotify's official Web API and Last.fm. Open it in Chrome and add it to your home screen. It's free.

## What it does

- **Song**: starts on the song playing now. You can also search a song or paste a Spotify link. *Play similar* plays that song, then only similar songs. *Add similar* adds similar songs to the end of your queue.
- **From Spotify**: in the Spotify app, share a song and pick *Vibe Queue*. The page opens with that song picked. Long-press the Vibe Queue icon for *Play similar* or *Add similar*, which use the song playing now.
- **Genre**: type a genre or a mood, like *phonk* or *chill*. *Play genre* plays a fresh mix and *Add genre* adds one to the queue, with at most a few songs per artist.
- **Blend**: pick 2 or 3 songs and/or genres. *Play blend* or *Add blend* takes turns between them.
- **Save as playlist**: saves the last mix as a new private playlist named after the mix and the date. *Play* starts a new mix and *Add* adds to it.
- **Settings**:
  - *Songs per mix*: 15, 25 or 50.
  - *New songs only*: leaves out your Liked Songs and your last 50 plays.
  - *Versions*: *Slowed* or *Sped up* swaps a song for that version when the same artist has one on Spotify.

Everything plays on the device where Spotify is active. That's normally your phone, but it can be your PC.

## What it can't do on the phone

- **Back fix**: a web page can't change what the Spotify app's Back button does.
- **Endless vibe** and **skip memory**: both need to watch playback all the time. Android pauses web pages that aren't on screen, so they'd only work with this page open in front. The desktop extension still does both.
- **Short links**: Spotify's *Copy link* gives `spotify.link` addresses. On a phone those lead straight into the Spotify app, so the page can't read them. Sharing the song to Vibe Queue works.
- **New songs only** can see only your last 50 plays, not 30 days. That's the most Spotify's API gives out.
- **Similar songs** come from Last.fm listening data, not from Spotify's song radio, because apps can't read Spotify's radio playlists anymore. Results are good for well-known songs. For brand-new or niche songs, the page falls back to top songs by similar artists.

## Limits to know

- **Spotify's search limit.** Development-mode apps get a search quota. Spotify doesn't publish the number, and forum reports from Oct–Nov 2026 describe blocks lasting up to ~17 hours. Each Last.fm song costs one Spotify search the first time, after which it's remembered on the phone (up to 4,000 songs).
  - Rough cost: a new 25-song mix uses about 25 searches, and the same mix again uses far fewer. Genres are cheap, about 10 songs per search. *Versions* adds one search per song.
  - Settings shows *Spotify searches today*, so you can see how close you get.
  - When the limit is hit, the page says how long to wait and builds mixes from remembered songs only.
- **Spotify accounts.** One developer app allows 5 Spotify accounts, the app owner needs Premium, and each developer gets only one app.
- **Login.** The Spotify login lasts 6 months. After that, tap *Connect Spotify* again.

## Setup (once)

### 1. Put the page online (GitHub Pages)

Spotify only accepts an `https://` address to come back to after login, so the page needs a host. GitHub Pages is free. These steps come from GitHub's docs:

1. Sign in to github.com (or make a free account).
2. **+** (top right) > **New repository**. Name it `vibe-queue-mobile` and set it to **Public**. On a free account, Pages needs a public repository. Then click **Create repository**.
3. **Add file** > **Upload files**, then drag in everything from this folder. Keep the `js` and `icons` folders as folders. Commit.
4. **Settings** > **Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the branch `main` and the folder `/ (root)`, then **Save**.
5. After a few minutes (up to 10), the page is at `https://<your-github-name>.github.io/vibe-queue-mobile/`.

The page holds no keys, so a stranger who opens it can't use your Spotify or Last.fm.

### 2. Spotify app (gives the Client ID)

The *Create app* form was checked on 2026-11-10. Spotify's rules: the app owner needs Premium, each developer gets one app, and up to 5 Spotify accounts can use it.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with your Premium account.
2. Click **Create app** (top right) and fill in:
   - **App name**: anything, for example *Vibe Queue*.
   - **App description**: anything, for example *My queue tool*.
   - **Website**: leave empty.
   - **Redirect URIs**: paste `https://<your-github-name>.github.io/vibe-queue-mobile/`, all in small letters and with the `/` at the end, then click **Add**. It only counts once it shows under the box. The page shows its own address under *Redirect URI* with a Copy button.
   - **Which API/SDKs are you planning to use?**: tick **Web API** only.
   - Tick **I understand and agree…**, then **Save**.
3. Copy the app's **Client ID**. You don't need the Client Secret. (The app's page wasn't checked yet. If the ID isn't shown, look under **Settings**.)
4. If the page later says the account "isn't on the app's user list", add your Spotify email under **User Management**.

To also log in from the PC for testing, add a second Redirect URI: `http://127.0.0.1:5500/`.

### 3. Last.fm API key

1. Log in to last.fm (or make a free account) and **verify your email**: click the link in Last.fm's email, or send it again at [last.fm/join/verify](https://www.last.fm/join/verify). Until then the API form stays greyed out.
2. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create). Only **Contact email** and **Application name** (for example *Vibe Queue*) are needed; leave the rest empty. Click **Submit**.
3. Copy the **API key**. You don't need the shared secret. Your keys stay listed at [last.fm/api/accounts](https://www.last.fm/api/accounts).

### 4. On the phone

1. Open the page's address in Chrome.
2. Paste the Client ID and the Last.fm API key, then tap **Connect Spotify** and agree.
3. In Chrome's menu (⋮), choose **Add to Home screen** (it may say *Install app*). Sharing from Spotify and the long-press shortcuts only work from this home-screen app. If Vibe Queue doesn't show up when you share from Spotify, remove the icon and add it again.
4. Have the Spotify app open, and play something once so it shows up as a device.

## Privacy

- Your keys, your Spotify login and the remembered songs stay in this browser's storage on the phone.
- The page only talks to Spotify (`accounts.spotify.com`, `api.spotify.com`, cover images from `i.scdn.co`, and `spotify.link` when you share or paste a short link) and Last.fm (`ws.audioscrobbler.com`). It has no analytics and loads no outside scripts or fonts.
- Last.fm's API terms allow non-commercial use. They ask for a "powered by AudioScrobbler" credit, which is in Settings. They also ask that public pages using their API be approved by them in writing (clause 2.7). This is a personal tool that does nothing without your own key, but don't share the link around. If you ever want to, ask partners@last.fm first.

## Testing on the PC

- `python dev/serve.py` serves the page at `http://127.0.0.1:5500/` with caching off. To log in there, add that Redirect URI (see step 2). Your phone can still be the device it plays on.
- `http://127.0.0.1:5500/?mock` runs the whole page against fake Spotify and Last.fm (`dev/mock.js`), and nothing leaves the PC. `?mock=quota` makes search run out after 25 searches. `?mock=fresh` starts at the setup screen. Add `&text=<a song link>` to act like a share from Spotify (a `spotify.link/...fail...` link acts like a phone, where short links can't be read), or `&do=play-similar` / `&do=add-similar` to act like a long-press shortcut.
- `python dev/make_icons.py` redraws the home-screen icons.

## Files

- `index.html`, `style.css`: the page.
- `js/app.js`: screens and buttons.
- `js/mix.js`: building mixes. Its matching, dedupe (`songKey`), turn-taking (`interleave`) and version matching (`coreTitle`) follow the desktop `vibeQueue.js`.
- `js/spotify.js`: Spotify Web API calls, the search counter and the quota block.
- `js/lastfm.js`: Last.fm calls.
- `js/auth.js`: login (Authorization Code with PKCE, no secret, no server).
- `sw.js`, `manifest.webmanifest`, `icons/`: the home-screen app, its entry in the Share menu (`share_target`) and its long-press shortcuts.
- `dev/`: the local server, the mock and the icon script. The page loads `dev/mock.js` only on `127.0.0.1` with `?mock`.
