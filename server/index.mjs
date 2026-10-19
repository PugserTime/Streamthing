// Lightweight backend: node:http + node:sqlite. No native deps => identical on Windows and Linux ARM64.
// Also runs packaged as a single Windows .exe (Node SEA): the UI is embedded, data lives next to the exe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import tls from 'node:tls';
import { Readable } from 'node:stream';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

// node:sqlite prints an "experimental" warning on load; it is stable enough for this app, so keep the console clean.
const _emit = process.emitWarning; process.emitWarning = (w, ...a) => { if (String(w?.message ?? w).includes('SQLite')) return; return _emit.call(process, w, ...a); };
const getBuiltin = n => { try { return process.getBuiltinModule(n); } catch { return null; } };
const sea = getBuiltin('node:sea');
export const IS_EXE = !!sea?.isSea?.();
const sqlite = getBuiltin('node:sqlite');
if (!sqlite) { console.error('[ERROR] This Node.js has no built-in SQLite. Install Node 22.13+ (or 22.5+ with --experimental-sqlite).'); process.exit(1); }
const { DatabaseSync } = sqlite;

// ROOT = project folder (dev) or the folder holding the .exe (packaged).
const ROOT = IS_EXE ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_TEMPLATE = `# Pi Media Center settings. Edit, save, then restart the app. All keys optional.
PORT=8080
HOST=127.0.0.1
# Free key: https://www.themoviedb.org/settings/api  (v3 "API Key")
TMDB_API_KEY=
# YouTube Data API v3 key (Google Cloud Console). Needed for YouTube search only.
YOUTUBE_API_KEY=
# Where the database + logs live (relative to this folder)
DATA_DIR=./data
# Optional fixed admin token. Only needed if you set HOST=0.0.0.0 to use it from other devices.
ADMIN_TOKEN=
# 1 = open in an app-style Edge window, 0 = open in your default browser
APP_WINDOW=1
# 0 = don't open any window on start
OPEN_BROWSER=1
`;
// .env lives next to the app. Accept ".env.txt" too (Notepad likes to add .txt).
const envFile = [path.join(ROOT, '.env'), path.join(ROOT, '.env.txt')].find(f => fs.existsSync(f)) || path.join(ROOT, '.env');
if (IS_EXE && !fs.existsSync(envFile)) { try { fs.writeFileSync(envFile, ENV_TEMPLATE.replace(/\n/g, os.EOL)); } catch {} }
const cleanVal = v => String(v ?? '').replace(/^﻿/, '').trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
const parseEnv = txt => { const o = {}; for (const l of txt.replace(/^﻿/, '').split(/\r?\n/)) { const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/); if (m) o[m[1].toUpperCase()] = m[2].replace(/^["']|["']$/g, ''); } return o; };
const KEY_NAMES = ['TMDB_API_KEY', 'YOUTUBE_API_KEY'];
const startupEnv = new Set(Object.keys(process.env));
let envMtime = 0;
// Re-read .env whenever it changes on disk, so pasting a key works without restarting the app.
function refreshEnv() {
  let st; try { st = fs.statSync(envFile); } catch { return; } if (st.mtimeMs === envMtime) return; envMtime = st.mtimeMs;
  let o; try { o = parseEnv(fs.readFileSync(envFile, 'utf8')); } catch { return; }
  for (const [k, v] of Object.entries(o)) { if (KEY_NAMES.includes(k)) process.env[k] = cleanVal(v); else if (!startupEnv.has(k)) process.env[k] = v; }
}
refreshEnv();
// Save keys typed in Settings back into .env (keeps every other line as-is).
function writeKeys(keys) {
  let txt = ''; try { txt = fs.readFileSync(envFile, 'utf8').replace(/^﻿/, ''); } catch { txt = ENV_TEMPLATE; }
  for (const [k, v] of Object.entries(keys)) { const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm'); const line = `${k}=${v}`; txt = re.test(txt) ? txt.replace(re, line) : txt.replace(/\s*$/, os.EOL + line + os.EOL); process.env[k] = v; }
  fs.writeFileSync(envFile, txt); envMtime = fs.statSync(envFile).mtimeMs;
}
const env = process.env;
const PORT = +(env.PORT || 8080), HOST = env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
// Data dir: next to the app if writable, otherwise %LOCALAPPDATA% (e.g. exe placed in Program Files).
function pickDataDir() {
  const want = path.resolve(ROOT, env.DATA_DIR || 'data');
  try { fs.mkdirSync(want, { recursive: true }); fs.accessSync(want, fs.constants.W_OK); return want; }
  catch { const alt = path.join(env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'PiMediaCenter'); fs.mkdirSync(alt, { recursive: true }); return alt; }
}
const DATA = pickDataDir();
const ADMIN = env.ADMIN_TOKEN || crypto.randomBytes(12).toString('hex');
// On a loopback-only bind the Host/Origin guards already block other sites, so no token is needed.
const ADMIN_REQUIRED = !!env.ADMIN_TOKEN || !LOOPBACK;
const VERSION = '0.9.1';
// Windows networking fixes:
// 1) Trust certificates installed in Windows (antivirus "HTTPS scanning", VPNs, school/work networks add their own).
//    Browsers already trust these; Node doesn't unless told to.
try { const all = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]; tls.setDefaultCACertificates(all); } catch {}
// 2) Prefer IPv4: some home routers advertise IPv6 that doesn't actually work, which makes requests hang.
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
// Turn a low-level network failure into something a person can act on.
function netReason(e, host) {
  const c = e?.cause?.code || e?.code || e?.name || ''; const m = String(e?.cause?.message || e?.message || '');
  if (/ENOTFOUND|EAI_AGAIN/.test(c)) return `This PC couldn't look up ${host} (DNS error ${c}). If other websites open fine, your internet provider's DNS may be blocking it: set your DNS to 1.1.1.1 or 8.8.8.8 and try again.`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS/.test(c + m)) return `The secure connection to ${host} was intercepted (${c || 'certificate error'}). This is usually antivirus "HTTPS/web scanning" (Avast, AVG, Kaspersky, ESET, Bitdefender) or a VPN. Add MediaCenter.exe as an exception or turn off HTTPS scanning.`;
  if (/Timeout|TIMEDOUT|ETIMEDOUT|CONNECT_TIMEOUT|AbortError/i.test(c + m)) return `${host} didn't answer in time (${c || 'timeout'}). A firewall or antivirus may be blocking MediaCenter.exe from the internet — allow it, then try again.`;
  if (/ECONNREFUSED|ECONNRESET|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET/.test(c)) return `The connection to ${host} was blocked or cut off (${c}). Check the internet connection, VPN, or firewall rules for MediaCenter.exe.`;
  return `Couldn't connect to ${host} (${c || m || 'unknown error'}). Check the internet connection.`;
}

const logFile = path.join(DATA, 'app.log');
const log = (lvl, msg) => { const line = `${new Date().toISOString()} ${lvl} ${msg}`; try { console.log(line); } catch {} try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.1'); fs.appendFileSync(logFile, line + '\n'); } catch {} };

// ---- database + versioned migrations ----
const dbPath = path.join(DATA, 'media.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
const MIGRATIONS = [
  `CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
   CREATE TABLE lists(kind TEXT NOT NULL, ref TEXT NOT NULL, data TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY(kind, ref));
   CREATE TABLE progress(ref TEXT PRIMARY KEY, pos REAL NOT NULL, dur REAL NOT NULL, title TEXT, mode TEXT, updated INTEGER NOT NULL);
   CREATE TABLE library_dirs(path TEXT PRIMARY KEY);
   CREATE TABLE library_files(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, size INTEGER, mtime INTEGER, missing INTEGER DEFAULT 0);`,
  `CREATE INDEX idx_progress_updated ON progress(updated DESC);`,
];
db.exec('CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)');
const ver = db.prepare('SELECT MAX(v) v FROM schema_version').get().v ?? 0;
for (let i = ver; i < MIGRATIONS.length; i++) { db.exec('BEGIN'); db.exec(MIGRATIONS[i]); db.prepare('INSERT INTO schema_version VALUES (?)').run(i + 1); db.exec('COMMIT'); log('INFO', `migrated db to v${i + 1}`); }

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 1e6) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > max) { no(new Error('body too large')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString() || '{}')); req.on('error', no); });
const isAdmin = req => !ADMIN_REQUIRED || req.headers['x-admin-token'] === ADMIN;
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv']);
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg' };

// Outbound: HTTPS only, two fixed hosts, timeout. Not a general proxy (no SSRF to LAN).
// Outbound calls: HTTPS to two fixed hosts only (not a general proxy).
// Flaky Wi-Fi friendly: retries transient failures, caches good answers, shares identical in-flight requests,
// and falls back to the last good copy (up to a day old) if the service can't be reached.
export const netStats = { requests: 0, upstream: 0, cacheHits: 0, retries: 0, failures: 0, staleServed: 0, lastError: null, lastMs: 0 };
const cache = new Map(), inflight = new Map();
const CACHE_MAX = 400, STALE_MAX = 24 * 3600e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
async function fetchOnce(url, ms, headers) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['api.themoviedb.org', 'www.googleapis.com'].includes(u.hostname)) throw new Error('host not allowed');
  let r; try { r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json', ...headers } }); }
  catch (e) { const err = new Error(netReason(e, u.hostname)); err.code = e?.cause?.code || e?.name; err.transient = true; throw err; }
  const body = await r.json().catch(() => ({}));
  if (r.ok) return { status: r.status, body };
  // Turn TMDB / Google error bodies into one readable message.
  const raw = body?.status_message || body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || `HTTP ${r.status}`;
  const msg = String(raw).replace(/<[^>]+>/g, '');
  const keyProblem = r.status === 401 || /api key|invalid key|API_KEY|referer|not been used|disabled|blocked/i.test(msg) && r.status !== 429;
  const out = { status: r.status === 401 || r.status === 403 ? 502 : r.status, body: { error: keyProblem ? 'bad_key' : 'upstream', message: msg }, retryable: RETRY_STATUS.has(r.status) };
  return out;
}
async function remote(url, { ttl = 0, headers = {}, timeout = 8000, attempts = 3 } = {}) {
  netStats.requests++;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) { netStats.cacheHits++; cache.delete(url); cache.set(url, hit); return { status: 200, body: hit.body, cached: true }; }
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    let last;
    for (let i = 0; i < attempts; i++) {
      if (i) { netStats.retries++; await sleep(i === 1 ? 500 : 1500); }
      const t0 = Date.now();
      try {
        netStats.upstream++; const r = await fetchOnce(url, timeout, headers); netStats.lastMs = Date.now() - t0;
        if (r.status < 400) { if (ttl) { cache.set(url, { t: Date.now(), body: r.body }); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); } return r; }
        last = r; if (!r.retryable) break;
      } catch (e) { last = e; if (!e.transient) break; }
    }
    netStats.failures++; netStats.lastError = { at: Date.now(), message: last?.message || last?.body?.message || 'failed', code: last?.code || last?.status };
    if (hit && Date.now() - hit.t < STALE_MAX) { netStats.staleServed++; return { status: 200, body: hit.body, stale: true }; }
    if (last instanceof Error) throw last; return last;
  })();
  inflight.set(url, job); try { return await job; } finally { inflight.delete(url); }
}

// ---- YouTube helpers: everything comes back as one small card shape the UI can render directly ----
const YT_BASE = 'https://www.googleapis.com/youtube/v3/';
async function ytApi(pth, params, ttl) {
  const q = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  const r = await remote(`${YT_BASE}${pth}?${q}`, { ttl });
  if (r.status >= 400) throw Object.assign(new Error(r.body?.message || 'YouTube error'), { http: r });
  return r.body;
}
const isoSecs = d => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ''); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; };
const isShort = v => v.dur > 0 && v.dur <= 60;
const avatars = new Map();
async function enrich(items) {
  const need = [...new Set(items.map(v => v.snippet?.channelId).filter(Boolean))].filter(id => !avatars.has(id));
  for (let i = 0; i < need.length; i += 50) {
    try { const b = await ytApi('channels', { part: 'snippet', id: need.slice(i, i + 50).join(','), maxResults: 50 }, 24 * 3600e3); for (const c of b.items || []) avatars.set(c.id, c.snippet?.thumbnails?.default?.url || ''); } catch {}
  }
  if (avatars.size > 3000) avatars.clear();
  return items.filter(v => v.snippet && v.status?.embeddable !== false).map(v => ({
    id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, channelId: v.snippet.channelId, channelThumb: avatars.get(v.snippet.channelId) || '',
    thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, dur: isoSecs(v.contentDetails?.duration), live: v.snippet.liveBroadcastContent === 'live',
    views: +(v.statistics?.viewCount || 0), published: v.snippet.publishedAt || null }));
}
async function videosByIds(ids) {
  if (!ids.length) return [];
  const b = await ytApi('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.slice(0, 50).join(','), maxResults: 50 }, 60 * 60e3);
  const byId = new Map((await enrich(b.items || [])).map(v => [v.id, v])); return ids.map(i => byId.get(i)).filter(Boolean);
}
const tmdbAuth = () => { const k = env.TMDB_API_KEY || ''; return k.startsWith('eyJ') && k.length > 60 ? { headers: { Authorization: `Bearer ${k}` }, param: null } : { headers: {}, param: k }; };
const hint = k => k ? `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars${k.startsWith('eyJ') ? ', read access token' : ''})` : null;
const needKey = (res, key, what, help) => { if (key) return false; json(res, 503, { error: 'not_configured', message: `${what} key not set. Add it in Settings → Accounts & keys.`, help }); return true; };
const TMDB_OK = [/^\/trending\/(movie|tv|all)\/(day|week)$/, /^\/(movie|tv)\/(popular|top_rated|now_playing|on_the_air)$/, /^\/search\/(movie|tv|multi)$/, /^\/discover\/(movie|tv)$/, /^\/genre\/(movie|tv)\/list$/, /^\/(movie|tv)\/\d+$/, /^\/(movie|tv)\/\d+\/(recommendations|credits|watch\/providers)$/, /^\/tv\/\d+\/season\/\d+$/];

// ---- library scanning: async, yields to event loop, incremental via size+mtime ----
let scan = { running: false, found: 0, last: null, errors: [] };
async function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { scan.errors.push(`${dir}: ${e.code}`); return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) await walk(p, out, depth + 1);
    else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
    await new Promise(r => setImmediate(r));
  }
}
export async function runScan() {
  if (scan.running) return; scan = { running: true, found: 0, last: null, errors: [] };
  try {
    const seen = new Set();
    for (const { path: d } of db.prepare('SELECT path FROM library_dirs').all()) {
      const files = []; await walk(d, files);
      for (const f of files) {
        try {
          const st = await fs.promises.stat(f); seen.add(f); const mt = Math.floor(st.mtimeMs), nm = path.parse(f).name;
          const row = db.prepare('SELECT size,mtime FROM library_files WHERE path=?').get(f);
          if (!row || row.size !== st.size || row.mtime !== mt) db.prepare('INSERT INTO library_files(path,name,size,mtime,missing) VALUES(?,?,?,?,0) ON CONFLICT(path) DO UPDATE SET size=?,mtime=?,missing=0,name=?').run(f, nm, st.size, mt, st.size, mt, nm);
          else db.prepare('UPDATE library_files SET missing=0 WHERE path=?').run(f);
          scan.found++;
        } catch (e) { scan.errors.push(`${f}: ${e.code}`); }
      }
    }
    for (const r of db.prepare('SELECT id,path FROM library_files').all()) if (!seen.has(r.path)) db.prepare('UPDATE library_files SET missing=1 WHERE id=?').run(r.id);
  } catch (e) { log('ERROR', 'scan failed: ' + e.message); }
  scan.running = false; scan.last = Date.now(); log('INFO', `scan done: ${scan.found} files, ${scan.errors.length} errors`);
}

// ---- subtitle files beside a video ----
const SUB_EXT = new Set(['.srt', '.vtt']);
const LANGS = { en: 'English', eng: 'English', english: 'English', es: 'Spanish', spa: 'Spanish', spanish: 'Spanish', espanol: 'Spanish', fr: 'French', fre: 'French', fra: 'French', french: 'French', de: 'German', ger: 'German', deu: 'German', german: 'German', it: 'Italian', ita: 'Italian', italian: 'Italian', pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese', ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese', ko: 'Korean', kor: 'Korean', korean: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', chinese: 'Chinese', ru: 'Russian', rus: 'Russian', russian: 'Russian', ar: 'Arabic', ara: 'Arabic', hi: 'Hindi', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish', vi: 'Vietnamese', tl: 'Filipino' };
const CODE = { English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Portuguese: 'pt', Japanese: 'ja', Korean: 'ko', Chinese: 'zh', Russian: 'ru', Arabic: 'ar', Hindi: 'hi', Dutch: 'nl', Polish: 'pl', Turkish: 'tr', Swedish: 'sv', Vietnamese: 'vi', Filipino: 'tl' };
async function findSubs(videoPath) {
  const dir = path.dirname(videoPath), base = path.parse(videoPath).name.toLowerCase(), out = [];
  const scan = async (d, mustMatch) => { let ents = []; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (!e.isFile() || !SUB_EXT.has(path.extname(e.name).toLowerCase())) continue; const n = path.parse(e.name).name; if (mustMatch && !n.toLowerCase().startsWith(base)) continue; out.push({ file: path.join(d, e.name), name: n, rest: mustMatch ? n.slice(base.length) : n }); } };
  await scan(dir, true);
  for (const sub of ['Subs', 'Subtitles', 'subs', 'subtitles']) { await scan(path.join(dir, sub), false); await scan(path.join(dir, sub, path.parse(videoPath).name), false); }
  const seen = new Set();
  const key = f => process.platform === 'win32' ? f.toLowerCase() : f; // Windows: "Subs" and "subs" are the same folder
  return out.filter(x => !seen.has(key(x.file)) && seen.add(key(x.file))).map(x => {
    const tags = x.rest.toLowerCase().split(/[.\s_\-\[\]()]+/).filter(Boolean);
    const langName = tags.map(t => LANGS[t]).find(Boolean);
    const extra = [tags.includes('forced') && 'forced', (tags.includes('sdh') || tags.includes('cc') || tags.includes('hi')) && 'SDH'].filter(Boolean).join(', ');
    return { file: x.file, lang: langName ? CODE[langName] : '', label: (langName || (x.rest.replace(/^[.\s_-]+/, '') || 'Subtitles')) + (extra ? ` (${extra})` : '') };
  }).sort((a, b) => (a.lang === 'en' ? -1 : 0) - (b.lang === 'en' ? -1 : 0));
}

// ---- YouTube captions, fetched by the server and drawn by our own subtitle renderer ----
// Same approach as common transcript tools: ask YouTube's player endpoint (as a mobile/TV client) for the caption
// tracks, then download the timed text. Several clients are tried because YouTube changes which ones work.
const YT_CLIENTS = [
  { id: 3, name: 'ANDROID', ver: '20.10.38', ctx: { androidSdkVersion: 30, osName: 'Android', osVersion: '11' }, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { id: 5, name: 'IOS', ver: '20.10.4', ctx: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' }, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)' },
  { id: 85, name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', ver: '2.0', ctx: {}, ua: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)', embed: true },
  { id: 1, name: 'WEB', ver: '2.20250312.04.00', ctx: {}, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36' },
];
async function ytHttp(url, opts = {}, ms = 9000) {
  const u = new URL(url); if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com') throw new Error('host not allowed');
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
  catch (e) { const err = new Error(netReason(e, u.hostname)); err.code = e?.cause?.code || e?.name; throw err; }
}
const unent = x => { let s = String(x); for (let i = 0; i < 2; i++) s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); return s; };
function parseTimedText(txt) {
  const cues = [];
  if (/^\s*WEBVTT/.test(txt)) { // vtt
    for (const b of txt.replace(/\r/g, '').split(/\n{2,}/)) { const l = b.split('\n'), i = l.findIndex(x => x.includes('-->')); if (i < 0) continue; const [a, z] = l[i].split('-->').map(x => x.trim().split(/\s+/)[0]); const ts = x => x.split(':').reduce((s, v) => s * 60 + parseFloat(v), 0);
      const text = l.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim(); if (text) cues.push({ a: ts(a), b: ts(z), text }); }
    return cues;
  }
  for (const m of txt.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) { // srv1: <text start="1.2" dur="3.4">
    const st = +(/start="([\d.]+)"/.exec(m[1])?.[1] || 0), du = +(/dur="([\d.]+)"/.exec(m[1])?.[1] || 2);
    const text = unent(m[2].replace(/<[^>]+>/g, '')).replace(/<(?!\/?[ibu]>)[^>]*>/g, '').trim(); if (text) cues.push({ a: st, b: st + du, text });
  }
  if (!cues.length) for (const m of txt.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) { // srv3: <p t="1200" d="3400"><s>word</s>…</p>
    const t = +(/\bt="(\d+)"/.exec(m[1])?.[1] || 0) / 1000, d = +(/\bd="(\d+)"/.exec(m[1])?.[1] || 2000) / 1000;
    const text = unent(m[2].replace(/<[^>]+>/g, '')).replace(/<(?!\/?[ibu]>)[^>]*>/g, '').replace(/\s+\n/g, '\n').trim(); if (text) cues.push({ a: t, b: t + d, text });
  }
  // auto-generated tracks overlap; cut each cue at the start of the next one
  cues.sort((x, y) => x.a - y.a); for (let i = 0; i < cues.length - 1; i++) if (cues[i].b > cues[i + 1].a) cues[i].b = cues[i + 1].a;
  return cues;
}
const toVtt = cues => 'WEBVTT\n\n' + cues.map(c => { const f = s => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; }; return `${f(c.a)} --> ${f(c.b)}\n${c.text}`; }).join('\n\n') + '\n';
const capCache = new Map(), cueCache = new Map();
async function downloadCues(track) {
  const u = new URL(track.url); u.searchParams.delete('fmt');
  const r = await ytHttp(u.toString(), { headers: { 'User-Agent': track.ua, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) return [];
  return parseTimedText(await r.text());
}
async function captionTracks(id) {
  const hit = capCache.get(id); if (hit && Date.now() - hit.t < 6 * 3600e3) return hit.tracks;
  let lastErr = null, noneSeen = false;
  for (const c of YT_CLIENTS) {
    try {
      const body = { context: { client: { clientName: c.name, clientVersion: c.ver, hl: 'en', gl: 'US', ...c.ctx }, ...(c.embed && { thirdParty: { embedUrl: 'https://www.youtube.com/' } }) }, videoId: id, contentCheckOk: true, racyCheckOk: true };
      const r = await ytHttp('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'X-YouTube-Client-Name': String(c.id), 'X-YouTube-Client-Version': c.ver, Origin: 'https://www.youtube.com' }, body: JSON.stringify(body) });
      if (!r.ok) { lastErr = new Error(`YouTube answered ${r.status} (${c.name})`); continue; }
      const j = await r.json();
      const list = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!list.length) { if (j?.playabilityStatus?.status === 'OK') noneSeen = true; continue; }
      const tracks = list.map((t, i) => ({ id: String(i), lang: t.languageCode || '', label: (n => n + (t.kind === 'asr' && !/auto/i.test(n) ? ' (auto-generated)' : ''))(t.name?.simpleText || (t.name?.runs || []).map(x => x.text).join('') || t.languageCode || 'Captions'), auto: t.kind === 'asr', url: t.baseUrl, ua: c.ua }));
      // make sure this client's links actually download (YouTube sometimes hands out links that return nothing)
      const first = tracks.find(t => !t.auto) || tracks[0]; const cues = await downloadCues(first);
      if (!cues.length) { lastErr = new Error(`caption download was empty (${c.name})`); continue; }
      cueCache.set(`${id}:${first.id}`, { t: Date.now(), cues });
      capCache.set(id, { t: Date.now(), tracks }); log('INFO', `captions for ${id}: ${tracks.length} track(s) via ${c.name}`); return tracks;
    } catch (e) { lastErr = e; }
  }
  if (noneSeen && !lastErr) { capCache.set(id, { t: Date.now(), tracks: [] }); return []; }
  throw lastErr || new Error('no captions');
}

// ---- Stream proxy: scraped streams often need Referer/Origin headers a browser can't send, so the server fetches them. ----
// Only URLs that came out of a scrape (or from inside a proxied playlist) are reachable, via unguessable tokens; private/LAN addresses are refused.
const STREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const streamTokens = new Map(), streamByUrl = new Map();
function streamToken(url, headers) {
  const ex = streamByUrl.get(url); if (ex && streamTokens.has(ex)) { streamTokens.get(ex).t = Date.now(); return ex; }
  const id = crypto.randomBytes(12).toString('hex'); streamTokens.set(id, { url, headers: headers || {}, t: Date.now() }); streamByUrl.set(url, id);
  if (streamTokens.size > 4000) for (const [k, v] of streamTokens) if (Date.now() - v.t > 6 * 3600e3) { streamTokens.delete(k); streamByUrl.delete(v.url); }
  return id;
}
const isPrivateIp = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^(::1?$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);
async function assertPublicUrl(u) {
  const url = new URL(u); if (!/^https?:$/.test(url.protocol)) throw new Error('bad scheme');
  const addrs = await dns.promises.lookup(url.hostname, { all: true }); if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('private address');
}
async function proxyStream(req, res, tok) {
  const e = streamTokens.get(tok); if (!e) return json(res, 404, { error: 'stream_gone', message: 'This stream link expired. Press Play again.' });
  try { await assertPublicUrl(e.url); } catch { return json(res, 403, { error: 'blocked' }); }
  const headers = { 'User-Agent': STREAM_UA, ...e.headers }; if (req.headers.range) headers.Range = req.headers.range;
  const ctl = new AbortController(); res.on('close', () => ctl.abort());
  let r; try { r = await fetch(e.url, { headers, signal: ctl.signal, redirect: 'follow' }); } catch (err) { if (!res.headersSent) json(res, 502, { error: 'upstream_failed', message: String(err.message).slice(0, 100) }); return; }
  const ct = r.headers.get('content-type') || '';
  if (/^text\/|mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(e.url)) {
    const txt = await r.text();
    if (txt.trimStart().startsWith('#EXTM3U')) {
      const base = r.url || e.url;
      const reg = u => { try { return '/api/stream/' + streamToken(new URL(u, base).toString(), e.headers) + '.m3u8'; } catch { return u; } };
      const out = txt.split(/\r?\n/).map(l => !l.trim() ? l : l.startsWith('#') ? l.replace(/URI="([^"]+)"/g, (_, u) => `URI="${reg(u)}"`) : reg(l.trim())).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }); return res.end(out);
    }
    res.writeHead(r.ok ? 200 : r.status, { 'Content-Type': ct || 'text/plain', 'Cache-Control': 'no-store' }); return res.end(txt);
  }
  const out = { 'Content-Type': ct || 'application/octet-stream', 'Accept-Ranges': r.headers.get('accept-ranges') || 'bytes', 'Cache-Control': 'no-store' };
  if (!r.headers.get('content-encoding')) for (const k of ['content-length', 'content-range']) { const v = r.headers.get(k); if (v) out[k] = v; }
  res.writeHead(r.status === 206 ? 206 : r.ok ? 200 : r.status, out);
  if (!r.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method; refreshEnv();
  if (p === '/api/scrape' && m === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { if (!res.destroyed) return json(res, 400, { error: 'bad_json', message: 'Invalid JSON request.' }); return; }
    const media = body?.media;
    const positiveInt = v => Number.isSafeInteger(v) && v > 0;
    if (!media || !['movie', 'show'].includes(media.type) || !/^\d+$/.test(String(media.tmdbId || '')) ||
        typeof media.title !== 'string' || !media.title.trim() || media.title.length > 500 ||
        !positiveInt(media.releaseYear) ||
        (media.type === 'show' && (!positiveInt(media.season?.number) || !positiveInt(media.episode?.number)))) {
      return json(res, 400, { error: 'bad_media', message: 'A title, releaseYear, numeric TMDB ID, and valid season/episode numbers for shows are required.' });
    }
    const cleanText = value => String(value ?? '')
      .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
      .replace(/\b(authorization|cookie|token|api[_-]?key|signature|password)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    const ctl = new AbortController();
    const debug = env.SCRAPE_DEBUG === '1';
    let finished = false;
    const onClose = () => { if (!finished) ctl.abort(); };
    res.on('close', onClose);
    const send = value => {
      if (!finished && !res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n');
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    log('INFO', `scrape media: ${JSON.stringify({ type: media.type, tmdbId: String(media.tmdbId), title: cleanText(media.title), releaseYear: media.releaseYear, season: media.season?.number, episode: media.episode?.number })}`);
    const classify = e => {
      const text = String(e?.name || '') + ' ' + String(e?.message || e || '');
      if (/timeout|timedout/i.test(text)) return 'timeout';
      if (/abort/i.test(text)) return 'aborted';
      if (/cannot read|undefined|unexpected|json|invalid.*response/i.test(text)) return 'unexpected_response';
      if (/http|status.*[45]\d\d/i.test(text)) return 'http_error';
      if (/notfound|not found|no valid stream|couldn.t find|no stream/i.test(text)) return 'not_found';
      return 'provider_error';
    };
    // Log metadata and response structure only; never upstream body values or signed URLs.
    const inspectShape = async response => {
      let reader, timer;
      try {
        if (!response.body) return 'no_body';
        reader = response.clone().body.getReader();
        const chunks = []; let size = 0;
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('preview_timeout')), 500); });
        for (;;) {
          const part = await Promise.race([reader.read(), deadline]);
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) return 'body_over_4096_bytes';
          chunks.push(Buffer.from(part.value));
        }
        const text = Buffer.concat(chunks).toString('utf8').trim();
        let value;
        try { value = JSON.parse(text); }
        catch { return text.startsWith('<') ? 'html_or_xml' : 'non_json'; }
        if (!value || typeof value !== 'object') return `json_${value === null ? 'null' : typeof value}`;
        if (Array.isArray(value)) return `json_array length=${value.length}`;
        const shape = v => Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v;
        return `json_object items=${shape(value.items)} stream=${shape(value.stream)}`;
      } catch { return 'shape_unavailable'; }
      finally { clearTimeout(timer); if (reader) { void reader.cancel().catch(() => {}); } }
    };
    const scraperFetch = async (input, init = {}) => {
      const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(15000), ...(init.signal ? [init.signal] : input instanceof Request && input.signal ? [input.signal] : [])]);
      const started = Date.now();
      // Host only: paths and query strings may themselves contain credentials.
      let host = 'unknown';
      try { host = new URL(input instanceof Request ? input.url : String(input)).hostname; } catch {}
      try {
        const response = await fetch(input, { ...init, signal });
        if (debug) {
          log('INFO', `scrape upstream host=${host} status=${response.status} contentType=${cleanText(response.headers.get('content-type') || '').slice(0, 100)} ms=${Date.now() - started}`);
          if (/json|text|html/i.test(response.headers.get('content-type') || '')) {
            void inspectShape(response).then(shape => log('INFO', `scrape response host=${host} shape=${shape}`));
          }
        }
        return response;
      } catch (e) {
        if (debug) log('WARN', `scrape upstream host=${host} category=${classify(e)} ms=${Date.now() - started}`);
        throw e;
      }
    };
    let deadline;
    try {
      const { makeProviders, makeStandardFetcher, targets } = await import('@jenish094/providers');
      const providers = makeProviders({ fetcher: makeStandardFetcher(scraperFetch), target: targets.NATIVE, consistentIpForRequests: true });
      const update = d => {
        const reason = d.reason || (d.error ? d.error.message || String(d.error) : undefined);
        const category = d.error ? classify(d.error) : d.status === 'notfound' ? 'not_found' : undefined;
        if (d.error) log('WARN', `scrape source ${cleanText(d.id)} category=${category}: ${cleanText(d.error.stack || d.error.message || d.error).slice(0, 12000)}`);
        else if (reason) log('INFO', `scrape source ${cleanText(d.id)}: ${cleanText(reason).slice(0, 500)}`);
        send({ ev: 'update', d: { id: d.id, percentage: d.percentage, status: d.status, reason: reason ? cleanText(reason).slice(0, 300) : undefined, category } });
      };
      const job = providers.runAll({ media, events: {
        init: d => send({ ev: 'init', d }), start: d => send({ ev: 'start', d }),
        update, discoverEmbeds: d => send({ ev: 'discoverEmbeds', d }),
      } });
      const limit = new Promise((_, reject) => {
        deadline = setTimeout(() => { ctl.abort(); reject(new Error('Scrape timeout after 90 seconds')); }, 90000);
      });
      const result = await Promise.race([job, limit]);
      const stream = result?.stream;
      const validUrl = value => {
        if (typeof value !== 'string' || !value.trim()) return false;
        try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch { return false; }
      };
      let play = null;
      if (stream?.type === 'hls' && validUrl(stream.playlist)) {
        play = { url: `/api/stream/${streamToken(stream.playlist, stream.headers)}.m3u8`, type: 'hls' };
      } else if (stream?.qualities && typeof stream.qualities === 'object') {
        const q = stream.qualities;
        const pick = ['4k', '2160', '1440', '1080', '720', '480', '360', 'unknown'].map(k => q[k]).find(v => validUrl(v?.url)) || Object.values(q).find(v => validUrl(v?.url));
        if (pick) play = { url: `/api/stream/${streamToken(pick.url, stream.headers)}`, type: 'mp4' };
      }
      send({ done: true, play, sourceId: result?.sourceId || null });
      log('INFO', `scrape ${media.type} ${media.tmdbId}: ${play ? 'found via ' + cleanText(result.sourceId) : 'no usable source'}`);
    } catch (e) {
      log('ERROR', `scrape failed category=${classify(e)}: ${cleanText(e?.stack || e).slice(0, 12000)}`);
      send({ done: true, play: null, error: classify(e) === 'timeout' ? 'The source search timed out.' : 'No direct stream could be loaded. Try an embedded player.' });
    } finally {
      clearTimeout(deadline);
      finished = true;
      ctl.abort();
      res.off('close', onClose);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
    return;
  }
  if (p.startsWith('/api/stream/') && (m === 'GET' || m === 'HEAD')) return proxyStream(req, res, p.slice('/api/stream/'.length).replace(/\.m3u8$/, ''));
  if (p === '/api/status') return json(res, 200, { version: VERSION, adminRequired: ADMIN_REQUIRED, exe: IS_EXE, dataDir: DATA, envFile, inTemp: /[\\/](temp|tmp)[\\/]/i.test(ROOT) || /\.zip/i.test(ROOT), keyHints: { tmdb: hint(env.TMDB_API_KEY), youtube: hint(env.YOUTUBE_API_KEY) }, tmdb: !!env.TMDB_API_KEY, youtube: !!env.YOUTUBE_API_KEY, platform: process.platform, arch: process.arch });
  if (p.startsWith('/api/tmdb/')) {
    if (needKey(res, env.TMDB_API_KEY, 'TMDB', 'https://www.themoviedb.org/settings/api')) return;
    const sub = p.slice(9); if (!TMDB_OK.some(r => r.test(sub))) return json(res, 400, { error: 'path_not_allowed' });
    const q = new URLSearchParams(); for (const [k, v] of url.searchParams) if (/^[a-z_]{1,24}$/.test(k) && v.length < 100) q.set(k, v);
    const au = tmdbAuth(); if (au.param) q.set('api_key', au.param); if (/^\/(movie|tv)\/\d+$/.test(sub)) q.set('append_to_response', 'videos,credits');
    const ttl = /^\/(movie|tv)\/\d+|season|genre/.test(sub) ? 6 * 3600e3 : /^\/search/.test(sub) ? 30 * 60e3 : 20 * 60e3;
    try { const r = await remote(`https://api.themoviedb.org/3${sub}?${q}`, { ttl, headers: au.headers }); return json(res, r.status, r.body); }
    catch (e) { log('WARN', `tmdb ${sub}: ${e.code || ''} ${e.message}`); return json(res, 502, { error: 'upstream_failed', message: e.message }); }
  }
  if (p === '/api/keys' && m === 'PUT') {
    if (!isAdmin(req)) return json(res, 403, { error: 'admin token required' });
    const b = JSON.parse(await readBody(req)); const upd = {};
    if (typeof b.tmdb === 'string') upd.TMDB_API_KEY = cleanVal(b.tmdb);
    if (typeof b.youtube === 'string') upd.YOUTUBE_API_KEY = cleanVal(b.youtube);
    for (const v of Object.values(upd)) if (v && !/^[A-Za-z0-9_\-.]{10,400}$/.test(v)) return json(res, 400, { error: 'bad_key', message: 'That doesn\'t look like a key. Copy only the key itself.' });
    cache.clear(); try { writeKeys(upd); } catch (e) { return json(res, 500, { error: 'write_failed', message: `Saved for now, but could not write ${envFile}: ${e.code}` }); }
    log('INFO', `keys updated: ${Object.keys(upd).join(', ')}`); return json(res, 200, { ok: true });
  }
  if (p === '/api/ytcaptions' || p === '/api/ytcaptions/vtt') { // works without an API key
    const id = url.searchParams.get('id') || ''; if (!/^[\w-]{11}$/.test(id)) return json(res, 400, { error: 'bad id' });
    try {
      const tracks = await captionTracks(id);
      if (p === '/api/ytcaptions') return json(res, 200, { tracks: tracks.map(({ url: _u, ua: _a, ...t }) => t) });
      const t = tracks.find(x => x.id === url.searchParams.get('track')); if (!t) return json(res, 404, { error: 'no such track' });
      const key = `${id}:${t.id}`; let c = cueCache.get(key); if (!c || Date.now() - c.t > 6 * 3600e3) { c = { t: Date.now(), cues: await downloadCues(t) }; if (c.cues.length) cueCache.set(key, c); }
      if (!c.cues.length) return json(res, 502, { error: 'empty', message: 'YouTube returned an empty caption file.' });
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(toVtt(c.cues));
    } catch (e) { log('WARN', `captions ${id}: ${e.message}`); return json(res, 502, { error: 'captions_failed', message: e.message }); }
  }
  if (p.startsWith('/api/youtube/')) {
    if (needKey(res, env.YOUTUBE_API_KEY, 'YouTube', 'https://console.cloud.google.com/apis/library/youtube.googleapis.com')) return;
    const sp = url.searchParams, region = /^[A-Z]{2}$/.test(sp.get('region') || '') ? sp.get('region') : 'US';
    const page = /^[A-Za-z0-9_-]{1,64}$/.test(sp.get('page') || '') ? sp.get('page') : undefined;
    try {
      if (p === '/api/youtube/popular') { // trending, optionally per category (Gaming = 20, Music = 10 …)
        const cat = /^\d{1,3}$/.test(sp.get('cat') || '') ? sp.get('cat') : undefined;
        const max = Math.min(50, Math.max(1, +sp.get('max') || 24));
        const b = await ytApi('videos', { part: 'snippet,contentDetails,statistics,status', chart: 'mostPopular', regionCode: region, maxResults: max, ...(cat && { videoCategoryId: cat }), ...(page && { pageToken: page }) }, 30 * 60e3);
        return json(res, 200, { items: (await enrich(b.items || [])).filter(v => !isShort(v)), next: b.nextPageToken || null });
      }
      if (p === '/api/youtube/search') { // search costs 100 quota units, so results are cached for 6 h
        const q = (sp.get('q') || '').trim().slice(0, 100); if (!q) return json(res, 400, { error: 'q required' });
        const order = ['relevance', 'date', 'viewCount', 'rating'].includes(sp.get('order')) ? sp.get('order') : 'relevance';
        const b = await ytApi('search', { part: 'id', type: 'video', videoEmbeddable: 'true', maxResults: 25, q, order, regionCode: region, relevanceLanguage: (sp.get('lang') || 'en').slice(0, 5), ...(page && { pageToken: page }) }, 6 * 3600e3);
        return json(res, 200, { items: await videosByIds((b.items || []).map(i => i.id?.videoId).filter(Boolean)), next: b.nextPageToken || null });
      }
      if (p === '/api/youtube/channels') { // newest uploads from channels you watch (≈1 unit per channel)
        const ids = (sp.get('ids') || '').split(',').filter(x => /^UC[A-Za-z0-9_-]{22}$/.test(x)).slice(0, 6);
        const lists = await Promise.all(ids.map(id => ytApi('playlistItems', { part: 'contentDetails', playlistId: 'UU' + id.slice(2), maxResults: 8 }, 60 * 60e3).catch(() => ({ items: [] }))));
        const vids = await videosByIds(lists.flatMap(l => (l.items || []).map(i => i.contentDetails?.videoId)).filter(Boolean));
        return json(res, 200, { items: vids.filter(v => !isShort(v)).sort((x, y) => String(y.published).localeCompare(String(x.published))) });
      }
      return json(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      if (e.http) return json(res, e.http.status, e.http.body);
      log('WARN', `youtube ${p}: ${e.code || ''} ${e.message}`); return json(res, 502, { error: 'upstream_failed', message: e.message });
    }
  }
  if (p === '/api/settings') { if (m === 'PUT') { const b = JSON.parse(await readBody(req)); db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('settings', JSON.stringify(b)); } const r = db.prepare("SELECT v FROM kv WHERE k='settings'").get(); return json(res, 200, r ? JSON.parse(r.v) : {}); }
  if (p === '/api/lists') {
    const kind = url.searchParams.get('kind') || ''; if (!/^(favorite|watchlater|ytsaved|ythistory)$/.test(kind)) return json(res, 400, { error: 'bad kind' });
    if (m === 'POST') { const b = JSON.parse(await readBody(req)); if (!b.ref) return json(res, 400, { error: 'ref required' }); db.prepare('INSERT OR REPLACE INTO lists VALUES(?,?,?,?)').run(kind, String(b.ref).slice(0, 200), JSON.stringify(b.data ?? {}), Date.now()); }
    if (m === 'DELETE') db.prepare('DELETE FROM lists WHERE kind=? AND ref=?').run(kind, url.searchParams.get('ref') || '');
    return json(res, 200, db.prepare('SELECT ref,data,added FROM lists WHERE kind=? ORDER BY added DESC LIMIT 200').all(kind).map(r => ({ ref: r.ref, ...JSON.parse(r.data), added: r.added })));
  }
  if (p === '/api/progress') {
    if (m === 'PUT') { const b = JSON.parse(await readBody(req)); if (typeof b.ref !== 'string' || !(b.dur > 0)) return json(res, 400, { error: 'bad progress' }); db.prepare('INSERT INTO progress VALUES(?,?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET pos=excluded.pos,dur=excluded.dur,updated=excluded.updated').run(b.ref.slice(0, 300), +b.pos, +b.dur, String(b.title || '').slice(0, 200), String(b.mode || ''), Date.now()); return json(res, 200, { ok: true }); }
    const ref = url.searchParams.get('ref'); if (ref) return json(res, 200, db.prepare('SELECT * FROM progress WHERE ref=?').get(ref) ?? null);
    return json(res, 200, db.prepare('SELECT * FROM progress ORDER BY updated DESC LIMIT 30').all());
  }
  if (p === '/api/library') return json(res, 200, { dirs: db.prepare('SELECT path FROM library_dirs').all().map(r => r.path), files: db.prepare('SELECT id,name,size,mtime FROM library_files WHERE missing=0 ORDER BY name').all(), scan });
  if (p === '/api/library/dirs') {
    if (!isAdmin(req)) return json(res, 403, { error: 'admin token required' });
    const b = JSON.parse(await readBody(req)); const d = path.resolve(String(b.path || '').trim().replace(/^["']+|["']+$/g, ''));
    if (m === 'POST') { try { if (!fs.statSync(d).isDirectory()) throw 0; } catch { return json(res, 400, { error: 'not_a_directory', message: `Cannot access folder: ${d}` }); } db.prepare('INSERT OR IGNORE INTO library_dirs VALUES(?)').run(d); runScan(); }
    if (m === 'DELETE') db.prepare('DELETE FROM library_dirs WHERE path=?').run(d);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/library/scan' && m === 'POST') { if (!isAdmin(req)) return json(res, 403, { error: 'admin token required' }); runScan(); return json(res, 202, { started: true }); }
  // Subtitles for local files: .srt / .vtt next to the video ("Movie.srt", "Movie.en.srt", "Movie.English.vtt")
  // or in a Subs / Subtitles folder beside it. Served as WebVTT.
  const sm = p.match(/^\/api\/library\/file\/(\d+)\/subs(?:\/(\d+))?$/);
  if (sm) {
    const row = db.prepare('SELECT path FROM library_files WHERE id=? AND missing=0').get(+sm[1]); if (!row) return json(res, 404, { error: 'not_found' });
    const list = await findSubs(row.path);
    if (sm[2] == null) return json(res, 200, list.map(({ file, ...t }, i) => ({ ...t, idx: i })));
    const t = list[+sm[2]]; if (!t) return json(res, 404, { error: 'not_found' });
    let buf; try { buf = await fs.promises.readFile(t.file); } catch { return json(res, 410, { error: 'file_missing' }); }
    if (buf.length > 5e6) return json(res, 413, { error: 'too_large' });
    let txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { txt = new TextDecoder('windows-1252').decode(buf); }
    txt = txt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!/^WEBVTT/.test(txt)) txt = 'WEBVTT\n\n' + txt.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/^\d+\n(?=\d{1,2}:\d{2})/gm, '');
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(txt);
  }
  const fm = p.match(/^\/api\/library\/file\/(\d+)$/);
  if (fm) { // only files already indexed under configured dirs; supports Range
    const row = db.prepare('SELECT path FROM library_files WHERE id=? AND missing=0').get(+fm[1]); if (!row) return json(res, 404, { error: 'not_found' });
    let st; try { st = await fs.promises.stat(row.path); } catch { db.prepare('UPDATE library_files SET missing=1 WHERE id=?').run(+fm[1]); return json(res, 410, { error: 'file_missing', message: 'File is gone (drive disconnected?).' }); }
    const type = MIME[path.extname(row.path).toLowerCase()] || 'application/octet-stream'; const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    let s = 0, e = st.size - 1;
    if (rg) { if (rg[1]) { s = +rg[1]; if (rg[2]) e = Math.min(+rg[2], e); } else if (rg[2]) s = Math.max(0, st.size - +rg[2]); if (s > e || s >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); } }
    res.writeHead(rg ? 206 : 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1, ...(rg && { 'Content-Range': `bytes ${s}-${e}/${st.size}` }) });
    const rs = fs.createReadStream(row.path, { start: s, end: e }); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); return rs.pipe(res);
  }
  if (p === '/api/system') { let free = null; try { const s = fs.statfsSync(DATA); free = s.bavail * s.bsize; } catch {} const mu = process.memoryUsage(); return json(res, 200, { version: VERSION, node: process.version, platform: `${process.platform}/${process.arch}`, cpus: os.cpus().length, load: os.loadavg(), totalMem: os.totalmem(), freeMem: os.freemem(), rss: mu.rss, heap: mu.heapUsed, uptime: process.uptime(), dataDirFree: free, dbSize: fs.statSync(dbPath).size, dbVersion: MIGRATIONS.length }); }
  if (p === '/api/debug') return json(res, 200, debugInfo());
  if (p === '/api/logs') return json(res, 200, { lines: (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n') : []).slice(-200) });
  if (p === '/api/quit' && m === 'POST') { if (!isAdmin(req)) return json(res, 403, { error: 'admin token required' }); json(res, 200, { ok: true }); setTimeout(shutdown, 200); return; }
  if (p === '/api/backup' && m === 'POST') { if (!isAdmin(req)) return json(res, 403, { error: 'admin token required' }); const f = path.join(DATA, `backup-${Date.now()}.db`); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); fs.copyFileSync(dbPath, f); return json(res, 200, { file: f }); }
  return json(res, 404, { error: 'unknown endpoint' });
}

const CT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
// UI files: embedded in the exe (packaged) or read from web/dist (dev/Pi).
const DIST = path.join(ROOT, 'web', 'dist');
let embedded = null;
if (IS_EXE) { try { embedded = new Map(JSON.parse(sea.getAsset('manifest.json', 'utf8')).map(k => [k, Buffer.from(sea.getAsset(k))])); } catch (e) { console.error('embedded UI missing: ' + e.message); } }
function readUi(rel) {
  if (embedded) return embedded.get(rel) ?? null;
  const f = path.join(DIST, rel); if (!f.startsWith(DIST + path.sep)) return null;
  try { return fs.statSync(f).isFile() ? fs.readFileSync(f) : null; } catch { return null; }
}
function serveStatic(req, res, url) {
  let rel; try { rel = path.posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, ''); } catch { res.writeHead(400); return res.end(); }
  if (rel.split('/').includes('..') || rel.includes('\\')) { res.writeHead(403); return res.end(); }
  let body = rel ? readUi(rel) : null; if (!body) { rel = 'index.html'; body = readUi(rel); }
  if (!body) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('Frontend not built. Run: npm run build'); }
  res.writeHead(200, { 'Content-Type': CT[path.posix.extname(rel)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); res.end(body);
}

let boundPort = PORT;
const okHost = h => { if (!LOOPBACK) return true; const host = String(h || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, ''); return ['127.0.0.1', 'localhost', '::1'].includes(host); };
export const server = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  // Host check blocks DNS-rebinding; Origin check blocks cross-site writes.
  if (!okHost(req.headers.host)) { res.writeHead(421, { 'Content-Type': 'text/plain' }); return res.end('Use http://127.0.0.1:' + boundPort); }
  if (req.method !== 'GET' && req.headers.origin) { let oh = ''; try { oh = new URL(req.headers.origin).host; } catch {} if (oh !== req.headers.host) return json(res, 403, { error: 'bad origin' }); }
  try { if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url); }
  catch (e) { log('ERROR', `${req.method} ${url.pathname}: ${String(e.message).slice(0, 120)}`); if (!res.headersSent) json(res, 500, { error: 'internal', message: 'Something went wrong. See logs.' }); }
});

function shutdown() { log('INFO', 'shutting down'); server.close(); try { db.close(); } catch {} process.exit(0); }

// ---- debug stats (only computed while the debug overlay asks for them) ----
const loopDelay = monitorEventLoopDelay({ resolution: 20 }); loopDelay.enable();
let cpuPrev = { u: process.cpuUsage(), t: process.hrtime.bigint() };
let winMem = { at: 0, bytes: null, procs: 0, busy: false };
// RAM of the Edge app window = every msedge.exe started with our private profile folder, plus its child processes.
function sampleWindowMem() {
  if (process.platform !== 'win32' || winMem.busy || Date.now() - winMem.at < 10000) return;
  winMem.busy = true;
  const dir = path.join(DATA, 'window').replace(/'/g, "''");
  const ps = `$d='${dir}'; $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"); $ids=@{}; foreach($p in $all){ if($p.CommandLine -and $p.CommandLine.Contains($d)){ $ids["$($p.ProcessId)"]=1 } }; for($i=0;$i -lt 3;$i++){ foreach($p in $all){ if($ids.ContainsKey("$($p.ParentProcessId)")){ $ids["$($p.ProcessId)"]=1 } } }; $sum=0; foreach($p in $all){ if($ids.ContainsKey("$($p.ProcessId)")){ $sum+=$p.WorkingSetSize } }; "$sum $($ids.Count)"`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, timeout: 9000 }, (err, out) => {
    const m = /(\d+)\s+(\d+)/.exec(String(out || '')); winMem = { at: Date.now(), bytes: !err && m && +m[2] > 0 ? +m[1] : null, procs: m ? +m[2] : 0, busy: false };
  });
}
function debugInfo() {
  const now = process.hrtime.bigint(), u = process.cpuUsage(cpuPrev.u), wall = Number(now - cpuPrev.t) / 1e3; cpuPrev = { u: process.cpuUsage(), t: now };
  const mu = process.memoryUsage(); sampleWindowMem();
  const out = { at: Date.now(), uptime: process.uptime(), rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal, external: mu.external,
    cpu: wall > 0 ? Math.min(100, (u.user + u.system) / wall * 100) : 0, cores: os.cpus().length, totalMem: os.totalmem(), freeMem: os.freemem(),
    loopMeanMs: Math.max(0, (loopDelay.mean / 1e6 || 20) - 20), loopMaxMs: Math.max(0, (loopDelay.max / 1e6 || 20) - 20), windowMem: winMem.bytes, windowProcs: winMem.procs,
    net: { ...netStats, cacheEntries: cache.size, inflight: inflight.size } };
  loopDelay.reset(); return out;
}

function findEdge() {
  if (process.platform !== 'win32') return null;
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  for (const b of bases) { const f = path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'); if (fs.existsSync(f)) return f; }
  return null;
}
function openUi(url) {
  try {
    const edge = env.APP_WINDOW !== '0' && findEdge();
    let fsOn = false; try { fsOn = !!JSON.parse(db.prepare("SELECT v FROM kv WHERE k='settings'").get()?.v || '{}').fullscreenOnLaunch; } catch {}
    if (edge) { spawn(edge, [`--app=${url}`, fsOn ? '--start-fullscreen' : '--start-maximized', `--user-data-dir=${path.join(DATA, 'window')}`], { detached: true, stdio: 'ignore' }).unref(); return; }
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch (e) { log('WARN', 'could not open a window: ' + e.message); }
}
const probe = port => new Promise(ok => { const r = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { ok(JSON.parse(b).version ? true : false); } catch { ok(false); } }); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
async function pauseThenExit(code) { if (IS_EXE && process.stdin.isTTY) { console.log('\nPress Enter to close this window.'); process.stdin.resume(); await new Promise(r => process.stdin.once('data', r)); } process.exit(code); }

async function start() {
  const wantOpen = env.OPEN_BROWSER ? env.OPEN_BROWSER !== '0' : IS_EXE;
  for (let port = PORT; port < PORT + 10; port++) {
    const err = await new Promise(ok => { server.once('error', ok); server.listen(port, HOST, () => { server.off('error', ok); ok(null); }); });
    if (!err) { boundPort = port; break; }
    if (err.code !== 'EADDRINUSE') { log('ERROR', `cannot listen on ${HOST}:${port}: ${err.message}`); return pauseThenExit(1); }
    if (await probe(port)) { // already running: just show it
      console.log(`Media Center is already running on http://127.0.0.1:${port} - opening it.`); if (wantOpen) openUi(`http://127.0.0.1:${port}`); return setTimeout(() => process.exit(0), 1500);
    }
    log('WARN', `port ${port} busy, trying ${port + 1}`);
    if (port === PORT + 9) { log('ERROR', 'no free port found'); return pauseThenExit(1); }
  }
  const shown = `http://${LOOPBACK ? '127.0.0.1' : HOST}:${boundPort}`;
  log('INFO', `listening on ${shown} (node ${process.version}, ${process.platform}/${process.arch}${IS_EXE ? ', exe' : ''})`);
  log('INFO', `data folder: ${DATA}`);
  if (ADMIN_REQUIRED && !env.ADMIN_TOKEN) log('INFO', `admin token (this session): ${ADMIN}`);
  if (!env.TMDB_API_KEY) log('WARN', `TMDB_API_KEY not set: Streaming metadata disabled (edit ${envFile})`);
  if (!env.YOUTUBE_API_KEY) log('WARN', `YOUTUBE_API_KEY not set: YouTube search disabled (edit ${envFile})`);
  if (IS_EXE) console.log(`\n  Media Center is running at ${shown}\n  Keep this window open. Close it (or press Ctrl+C) to quit.\n`);
  if (wantOpen) openUi(shown);
}
if (IS_EXE || process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('SIGHUP', shutdown);
  process.on('uncaughtException', e => log('ERROR', 'uncaught: ' + (e?.stack || e)));
  start();
}
