# Pi Media Center (Windows-first, Raspberry Pi 5 second)

Launcher with four modes: **YouTube**, **Streaming** (TMDB discovery + trailers), **My Media** (local files, real playback), **Settings**.
Stack: React + TypeScript + Vite frontend; **Node 22 backend (`node:http` + built-in `node:sqlite`, zero npm runtime deps beyond React)**. No Electron.

**Why Node instead of Rust:** no Rust toolchain was available in the build environment, and the backend is I/O-bound glue (HTTP, SQLite, file streaming). `node:sqlite` needs no native compilation, so Windows x64 and Pi ARM64 run identical code. A Rust port is possible later behind the same `/api` contract.

## GitHub Actions builds

The repository includes GitHub Actions workflows under `.github/workflows/`:
- **Build Pi Media Center** builds the web UI and portable Windows x64 executable on pushes, pull requests, and manual runs. Download `Pi-Media-Center-Windows-x64` from the run's **Artifacts** section.
- **Release portable Windows build** attaches `MediaCenter.exe` to a GitHub Release when you push a version tag such as `v0.9.2`.

The executable is unsigned, so SmartScreen warnings may still appear. See `.github/BUILDING.md` for details.

## Windows (10/11) — MediaCenter.exe
**Just run it:** double-click `MediaCenter.exe`. No Node install needed. It opens the app in an Edge app window (falls back to your default browser) and keeps a console window open with the log — closing that window (or Settings → System → Quit) stops it.
* First run creates `.env` and `data\` next to the exe (or in `%LOCALAPPDATA%\PiMediaCenter` if that folder isn't writable). Put it in its own folder, e.g. `C:\MediaCenter\`.
* Add your keys in **Settings → Accounts & keys** (paste, Save key — it's tested immediately, no restart). Editing `.env` in Notepad also works and is picked up live. TMDB accepts either the 32-character API key or the long Read Access Token.
* Running it again while it's already running just reopens the window. If port 8080 is taken it uses 8081–8089.
* Windows SmartScreen may say "Windows protected your PC" because the exe isn't code-signed: click **More info → Run anyway**.
* No admin token is needed when bound to 127.0.0.1 (the default). If you set `HOST=0.0.0.0` for LAN use, a token is required and printed in the console.
* Flaky internet: TMDB/YouTube calls retry automatically (3 tries server-side, then the screen retries quietly at 5/15/30 s), answers are cached 20 min–6 h, and the last good copy (up to a day old) is shown if the service can't be reached.
* Debug overlay: Settings → System → Show debug info on screen, or F2. Shows app RAM (server + the Edge app window on Windows), CPU, JS heap, FPS, network/cache stats and the last error.
* `.env` options: `APP_WINDOW=0` opens a normal browser tab instead of the app window; `OPEN_BROWSER=0` starts it headless.

**Rebuild the exe** (from Windows, Linux or macOS, Node 22.13+): `npm ci && npm run build:exe` → `dist/MediaCenter.exe`. It bundles the server with esbuild, embeds the built UI, and injects it into the official Windows `node.exe` of the same version (Node Single Executable Application), with the app icon from `build-assets/icon.ico`.

**Dev:** `npm run dev:server` + `npm run dev:web` (http://localhost:5173). Without the exe: `run-windows.bat` (needs Node 22.13+).

## Keys and what needs them
| Feature | Needs |
|---|---|
| Streaming browse/search/details/trailers + official US provider availability | TMDB key (free) |
| YouTube search | YouTube Data API v3 key (quota applies) |
| YouTube watch/saved/history | nothing (embed by video id; saved/history are local) |
| My Media, Settings, launcher | nothing |
| Firebase sync | **not implemented** |

## Raspberry Pi 5 (Raspberry Pi OS 64-bit)
```
sudo apt update && sudo apt install -y git chromium-browser   # or: chromium
# install Node 22+ arm64 (NodeSource or nodejs.org tarball)
git clone <your repo> ~/media-center && cd ~/media-center
./deploy/install-pi.sh          # builds, installs systemd unit, enables at boot (runs as your user)
```
Kiosk (optional): `deploy/kiosk.md`. Logs: `journalctl -u media-center -f` and `data/app.log`.
Update: `git pull && npm ci && npm run build && sudo systemctl restart media-center`.
Backup: Settings → System → Backup (or copy `data/media.db` while stopped). Restore: stop service, replace `data/media.db`, start.
Uninstall: `sudo systemctl disable --now media-center && sudo rm /etc/systemd/system/media-center.service`.
The server binds to 127.0.0.1 by default and has no user login; do not expose it to the internet.

## Troubleshooting
* `Frontend not built` → `npm run build`. * `No such built-in module: node:sqlite` → Node < 22.5. * `Setup needed` banners → missing API key. * Video won't play → browser supports H.264/AAC MP4, WebM/VP9 best; MKV/HEVC/AC3 often fail; **no transcoding is performed**. * Port busy → change `PORT` in `.env`.

## Status
**Verified:** Windows exe built (Node 22.22.0 SEA, 82 MB) and run under Wine 9 (win32/x64): startup, `.env` auto-create, DB migrations, embedded UI served, library scan of a folder, HTTP Range video streaming, settings/lists/progress persistence, backup, second-launch detection, Quit endpoint. UI driven in headless Chromium against the exe: launcher, keyboard nav, Streaming setup banner, My Media list + WebM playback with resume progress, YouTube page, Settings tabs. Plain `node server/index.mjs` mode still works (Pi path).
**NOT verified:** on a real Windows 10/11 machine (Wine is close but not identical — e.g. Edge app-window launch, SmartScreen); live TMDB/YouTube calls (no keys); Raspberry Pi.
**Known limitations:** no Firebase; no streaming-provider playback (by design, see docs/CINEJOY_ANALYSIS.md); no transcoding (MKV/HEVC/AC3 often won't play — MP4 H.264/AAC or WebM are safe); no subtitles/audio-track UI; no artwork for local files; exe is unsigned.

## Authorized direct-stream playback

The Streaming details screen includes **Play an authorized stream**. Paste a direct HTTPS URL to media you own or are authorized to play (for example, a direct MP4 or WebM URL) to open it in the built-in player. Playback controls, seeking, volume, fullscreen, and playback-rate controls use the existing player UI. HLS (`.m3u8`) support depends on the browser/runtime; Chromium on Windows may require an HLS-capable playback library for some streams. Provider embed-page URLs are not direct video URLs, and browser cross-origin/CORS or provider restrictions may prevent playback.

This is a generic direct-media feature, not an integration with third-party stream-extraction services. It does not bypass authentication, DRM, or provider access controls.
