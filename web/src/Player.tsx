import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, put, fmt } from './api';
import { useApp } from './App';
import { Btn, Glyph, Icon, useBack } from './ui';
import 'lite-youtube-embed';
import Hls from 'hls.js';
import { Cue } from './config/subtitles';

export type Source = 
  | { kind: 'file'; id: number } 
  | { kind: 'youtube'; id: string } 
  | { kind: 'remote'; url: string } 
  | { kind: 'iframe'; url: string }
  | { kind: 'direct'; url: string; type?: 'hls' | 'mp4' };

type Props = { 
  source: Source; 
  title: string; 
  subtitle?: string; 
  actions?: ReactNode; 
  thumb?: string; 
  onClose: () => void; 
  volume?: number; 
  resume?: boolean; 
  saveProgress?: boolean;
  cues?: Cue[]; // External subtitles
};

export type Track = { id: string; lang: string; label: string; raw?: any; native?: boolean; auto?: boolean };

interface Engine { play(): void; pause(): void; seek(t: number): void; time(): number; dur(): number; buffered(): number; setVolume(v: number): void; setMuted(m: boolean): void; setRate(r: number): void; rates(): number[];
  setTrack(t: Track | null): void; setSubSize(n: number): void; nativeCaptions?(): void; layout(w: number, h: number, fill: boolean, quality?: string): void; quality?(): string; destroy(): void }
type Ev = { onTime(t: number, d: number): void; onState(s: 'playing' | 'paused' | 'buffering' | 'ended'): void; onReady(d: number): void; onError(msg: string, openUrl?: string): void; onTracks(t: Track[]): void };

// ---------- YouTube ----------
export const QUALITIES: [string, string, number][] = [['auto', 'Auto (sharp for your screen)', 0], ['2160', 'Best available (up to 4K)', 2160], ['1440', '1440p', 1440], ['1080', '1080p', 1080], ['720', '720p', 720], ['480', 'Data saver (480p)', 480]];
const Q_LABEL: Record<string, string> = { tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '4K', highres: '4K+' };
const VQ: Record<string, string> = { '2160': 'hd2160', '1440': 'hd1440', '1080': 'hd1080', '720': 'hd720', '480': 'large', auto: 'hd1080' };
let ytLoad: Promise<any> | null = null;
export function loadYT(): Promise<any> {
  const w = window as any; if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!ytLoad) ytLoad = new Promise((ok, no) => {
    const t = setTimeout(() => { ytLoad = null; no(new Error('The YouTube player didn\'t load.')); }, 15000);
    const prev = w.onYouTubeIframeAPIReady; w.onYouTubeIframeAPIReady = () => { clearTimeout(t); prev?.(); ok(w.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { clearTimeout(t); ytLoad = null; s.remove(); no(new Error('The YouTube player couldn\'t be loaded.')); };
    document.head.appendChild(s);
  });
  return ytLoad;
}
const YT_ERR: Record<number, string> = { 2: 'This video link is invalid.', 5: 'YouTube had a problem playing this video.', 100: 'This video was removed or is private.', 101: 'The owner doesn\'t allow this video to play outside YouTube.', 150: 'The owner doesn\'t allow this video to play outside YouTube.', 153: 'YouTube refused to play this video here.' };
function ytFrame(W: number, H: number, fill: boolean) {
  const ar = 16 / 9; let vw: number, vh: number;
  if (fill ? W / H > ar : W / H < ar) { vw = W; vh = W / ar; } else { vh = H; vw = H * ar; }
  const edge = Math.max(170, vh * 0.17) + Math.max(0, (H - vh) / 2);
  return { width: vw, height: vh + edge * 2, left: (W - vw) / 2, top: (H - vh) / 2 - edge, vh };
}
function youtubeEngine(host: HTMLElement, id: string, ev: Ev, volume: number, wantLang: string, subSize: number, quality = 'auto'): Engine {
  let p: any = null, dead = false, poll: any = null, capPoll: any = null, pending: (() => void)[] = [], box = { w: 0, h: 0, fill: false, q: 'auto' };
  let tracksReady = false, desired: Track | null = null, wantNative = false;
  const when = (f: () => void) => p?.getPlayerState ? f() : pending.push(f);
  const lite = document.createElement('lite-youtube') as any;
  lite.setAttribute('videoid', id); lite.setAttribute('js-api', ''); lite.setAttribute('playlabel', '');
  lite.setAttribute('params', new URLSearchParams({ controls: '0', vq: VQ[quality] || 'hd1080', disablekb: '1', fs: '0', rel: '0', iv_load_policy: '3', modestbranding: '1', cc_load_policy: '0', ...(wantLang && { cc_lang_pref: wantLang }), hl: (navigator.language || 'en').split('-')[0], enablejsapi: '1', origin: location.origin }).toString());
  host.appendChild(lite);
  const place = () => {
    if (!box.w) return; const r = ytFrame(box.w, box.h, box.fill), videoH = r.vh;
    const target = box.q === 'auto' ? videoH * Math.max(1, devicePixelRatio || 1) : +box.q || videoH;
    const k = Math.max(0.25, Math.min(4, target / videoH));
    Object.assign(lite.style, { width: `${r.width * k}px`, height: `${r.height * k}px`, left: `${r.left}px`, top: `${r.top}px`, transform: `scale(${1 / k})`, transformOrigin: '0 0' });
  };
  const applyTrack = () => { try { if (desired) { p.setOption('captions', 'track', desired.raw); p.setOption('captions', 'fontSize', subSize); } else p.setOption('captions', 'track', {}); } catch {} };
  const readTracks = () => {
    if (tracksReady || !p?.getOption) return;
    let list: any[] = []; try { list = p.getOption('captions', 'tracklist') || []; } catch {}
    if (!list.length) return;
    tracksReady = true; clearInterval(capPoll);
    ev.onTracks(list.map(t => ({ id: `n:${t.languageCode}${t.kind === 'asr' ? ':auto' : ''}${t.vss_id || ''}`, lang: t.languageCode, label: `${t.displayName || t.languageName || t.languageCode}`, raw: t, native: true, auto: t.kind === 'asr' })));
    applyTrack();
  };
  const startCaptionWatch = () => { if (tracksReady || capPoll) return; try { p.loadModule('captions'); } catch {} let n = 0; capPoll = setInterval(() => { readTracks(); if (++n > 40 || tracksReady) { clearInterval(capPoll); if (!tracksReady) ev.onTracks([]); } }, 500); };
  loadYT().then(async () => {
    if (dead) return;
    p = await lite.getYTPlayer(); if (dead) { try { p.destroy(); } catch {} return; }
    const frame: HTMLIFrameElement | null = p.getIframe?.() || null; if (frame) { frame.tabIndex = -1; frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture'); }
    const onState = (s: number) => { if (s === 1) ev.onState('playing'); else if (s === 2) ev.onState('paused'); else if (s === 3) ev.onState('buffering'); else if (s === 0) ev.onState('ended'); if (s === 1 || s === 3) { const d = p.getDuration(); if (d) ev.onReady(d); } if (s === 1 && wantNative) startCaptionWatch(); };
    p.addEventListener('onStateChange', (e: any) => onState(e.data));
    p.addEventListener('onApiChange', () => readTracks());
    p.addEventListener('onError', (e: any) => ev.onError(YT_ERR[e.data] || `YouTube error ${e.data}.`, `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`));
    p.setVolume(Math.round(volume * 100)); ev.onReady(p.getDuration() || 0); pending.splice(0).forEach(f => f());
    const st = p.getPlayerState?.(); if (st != null && st !== -1 && st !== 5) onState(st); else p.playVideo();
    poll = setInterval(() => { if (p?.getCurrentTime) ev.onTime(p.getCurrentTime() || 0, p.getDuration() || 0); }, 250);
  }).catch(e => ev.onError(e?.message || 'The YouTube player couldn\'t be loaded.'));
  return {
    play: () => when(() => p.playVideo()), pause: () => when(() => p.pauseVideo()), seek: t => when(() => { p.seekTo(Math.max(0, t), true); ev.onTime(t, p.getDuration()); }),
    time: () => p?.getCurrentTime?.() || 0, dur: () => p?.getDuration?.() || 0, buffered: () => p?.getVideoLoadedFraction?.() || 0,
    setVolume: v => when(() => p.setVolume(Math.round(v * 100))), setMuted: m => when(() => m ? p.mute() : p.unMute()),
    setRate: r => when(() => p.setPlaybackRate(r)), rates: () => p?.getAvailablePlaybackRates?.() || [0.5, 0.75, 1, 1.25, 1.5, 2],
    setTrack: t => { desired = t; if (tracksReady) when(applyTrack); },
    nativeCaptions: () => { wantNative = true; when(() => { if (p.getPlayerState() === 1) startCaptionWatch(); }); },
    setSubSize: n => { subSize = n; when(() => { try { p.setOption('captions', 'fontSize', n); } catch {} }); },
    layout: (w, h, fill, q = 'auto') => { box = { w, h, fill, q }; place(); },
    quality: () => { try { return Q_LABEL[p?.getPlaybackQuality?.()] || ''; } catch { return ''; } },
    destroy: () => { dead = true; clearInterval(poll); clearInterval(capPoll); try { p?.destroy?.(); } catch {} host.innerHTML = ''; },
  };
}

// ---------- local file via <video> ----------
const MEDIA_ERR: Record<number, string> = { 1: 'Playback was stopped.', 2: 'The file couldn\'t be read.', 3: 'The file is damaged.', 4: 'This video uses a format the player can\'t decode.' };
function fileEngine(host: HTMLElement, id: number, ev: Ev, volume: number, attempt: number): Engine {
  const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.preload = 'auto'; v.volume = volume; v.src = `/api/library/file/${id}?r=${attempt}`;
  v.onloadedmetadata = () => ev.onReady(v.duration); v.ontimeupdate = () => ev.onTime(v.currentTime, v.duration);
  v.onplaying = () => ev.onState('playing'); v.onpause = () => ev.onState('paused'); v.onwaiting = () => ev.onState('buffering'); v.onended = () => ev.onState('ended');
  v.onerror = () => ev.onError(MEDIA_ERR[v.error?.code || 0] || 'Playback failed.');
  host.appendChild(v);
  api<any[]>(`/library/file/${id}/subs`).then(l => ev.onTracks(l.map(t => ({ id: String(t.idx), lang: t.lang, label: t.label })))).catch(() => ev.onTracks([]));
  return {
    play: () => { v.play().catch(() => {}); }, pause: () => v.pause(), seek: t => { v.currentTime = Math.max(0, Math.min(v.duration || t, t)); }, time: () => v.currentTime, dur: () => v.duration || 0,
    buffered: () => { try { const b = v.buffered, n = v.currentTime; for (let i = 0; i < b.length; i++) if (b.start(i) <= n + 1 && b.end(i) >= n) return b.end(i) / (v.duration || 1); } catch {} return 0; },
    setVolume: x => { v.volume = x; }, setMuted: m => { v.muted = m; }, setRate: r => { v.playbackRate = r; }, rates: () => [0.5, 0.75, 1, 1.25, 1.5, 2],
    setTrack: () => {}, setSubSize: () => {}, layout: (_w, _h, fill) => { v.style.objectFit = fill ? 'cover' : 'contain'; },
    destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); },
  };
}

// ---------- remote/direct stream via <video> + hls.js ----------
function directEngine(host: HTMLElement, url: string, type: 'hls' | 'mp4' | undefined, ev: Ev, volume: number): Engine {
  const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.preload = 'auto'; v.volume = volume;
  let hls: Hls | null = null;

  if (type === 'hls' && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) ev.onError('HLS stream failed to load. Try another source.');
    });
  } else {
    v.src = url; // Native MP4 or Safari native HLS
  }

  v.onloadedmetadata = () => ev.onReady(v.duration); v.ontimeupdate = () => ev.onTime(v.currentTime, v.duration);
  v.onplaying = () => ev.onState('playing'); v.onpause = () => ev.onState('paused'); v.onwaiting = () => ev.onState('buffering'); v.onended = () => ev.onState('ended');
  v.onerror = () => ev.onError('This URL did not provide a playable video. Check the link, format, or CORS policy.');
  host.appendChild(v);
  return {
    play: () => { v.play().catch(() => {}); }, pause: () => v.pause(), seek: t => { v.currentTime = Math.max(0, Math.min(v.duration || t, t)); }, time: () => v.currentTime, dur: () => v.duration || 0,
    buffered: () => { try { const b = v.buffered, n = v.currentTime; for (let i = 0; i < b.length; i++) if (b.start(i) <= n + 1 && b.end(i) >= n) return b.end(i) / (v.duration || 1); } catch {} return 0; },
    setVolume: x => { v.volume = x; }, setMuted: m => { v.muted = m; }, setRate: r => { v.playbackRate = r; }, rates: () => [0.5, 0.75, 1, 1.25, 1.5, 2],
    setTrack: () => {}, setSubSize: () => {}, layout: (_w, _h, fill) => { v.style.objectFit = fill ? 'cover' : 'contain'; },
    destroy: () => { if (hls) hls.destroy(); v.pause(); v.removeAttribute('src'); v.load(); v.remove(); },
  };
}

// ---------- iframe ----------
function iframeEngine(host: HTMLElement, url: string, ev: Ev): Engine {
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;inset:0;background:#000;';
  const frame = document.createElement('iframe'); frame.src = url;
  frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write');
  frame.setAttribute('allowfullscreen', 'true'); frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
  wrap.appendChild(frame); host.appendChild(wrap);
  frame.onload = () => { ev.onReady(0); ev.onState('playing'); };
  return {
    play: () => {}, pause: () => {}, seek: () => {}, time: () => 0, dur: () => 0, buffered: () => 0,
    setVolume: () => {}, setMuted: () => {}, setRate: () => {}, rates: () => [1],
    setTrack: () => {}, setSubSize: () => {}, layout: () => {},
    destroy: () => { try { frame.src = 'about:blank'; } catch {} wrap.remove(); },
  };
}

const cueHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?)(i|b|u)&gt;/g, '<$1$2>').replace(/\{\\[^}]*\}/g, '').replace(/\n/g, '<br>');
const SIZES: [string, string, number][] = [['s', 'Small', -1], ['m', 'Medium', 0], ['l', 'Large', 1], ['xl', 'Extra large', 2]];

const STEPS = [10, 10, 10, 15, 20, 30, 30, 60, 60, 120, 180, 300];
function SeekBar({ t, d, buf, onCommit, onScrub, previewSrc }: { t: number; d: number; buf: number; onCommit: (n: number) => void; onScrub: (on: boolean) => void; previewSrc?: string }) {
  const [pend, setPend] = useState<number | null>(null), [hover, setHover] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null), last = useRef(0), cnt = useRef(0), drag = useRef(false), canvas = useRef<HTMLCanvasElement>(null), pv = useRef<HTMLVideoElement | null>(null), pvT = useRef<any>();
  const clamp = (n: number) => Math.max(0, Math.min(d || 0, n));
  const setP = (n: number | null) => { setPend(n); onScrub(n != null); };
  const at = (x: number) => { const r = bar.current!.getBoundingClientRect(); return clamp(((x - r.left) / r.width) * d); };
  const shown = pend ?? hover;
  useEffect(() => {
    if (!previewSrc || shown == null) return;
    clearTimeout(pvT.current); pvT.current = setTimeout(() => {
      if (!pv.current) { const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = previewSrc; v.onseeked = () => { const c = canvas.current; if (c) c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height); }; pv.current = v; }
      try { pv.current.currentTime = shown; } catch {}
    }, 90);
  }, [shown, previewSrc]);
  useEffect(() => () => { clearTimeout(pvT.current); if (pv.current) { pv.current.removeAttribute('src'); pv.current.load(); } }, []);
  const key = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const now = Date.now(); cnt.current = e.repeat || now - last.current < 450 ? cnt.current + 1 : 0; last.current = now;
      const step = STEPS[Math.min(cnt.current, STEPS.length - 1)] * (k === 'ArrowRight' ? 1 : -1);
      setP(clamp((pend ?? t) + step)); e.preventDefault(); e.stopPropagation();
    } else if ((k === 'Enter' || k === ' ') && pend != null) { onCommit(pend); setP(null); e.preventDefault(); e.stopPropagation(); }
    else if ((k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') && pend != null) { setP(null); e.preventDefault(); e.stopPropagation(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { if (pend != null) setP(null); }
  };
  const pctOf = (n: number) => `${d ? (n / d) * 100 : 0}%`;
  return <div ref={bar} className={'seekbar' + (pend != null ? ' scrubbing' : '')} role="slider" tabIndex={0} data-nav aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(pend ?? t)} aria-valuetext={fmt(pend ?? t)}
    onKeyDown={key} onBlur={() => { if (pend != null) setP(null); }}
    onPointerDown={e => { if (!d) return; drag.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setP(at(e.clientX)); }}
    onPointerMove={e => { if (!d) return; const n = at(e.clientX); if (drag.current) setP(n); else setHover(n); }}
    onPointerUp={() => { if (drag.current && pend != null) onCommit(pend); drag.current = false; setP(null); }}
    onPointerLeave={() => setHover(null)}>
    <div className="track"><i className="buf" style={{ width: `${Math.min(100, buf * 100)}%` }} /><i className="played" style={{ width: pctOf(t) }} />
      {pend != null && <i className="ghost" style={{ left: pctOf(Math.min(t, pend)), width: pctOf(Math.abs(pend - t)) }} />}</div>
    <span className="knob" style={{ left: pctOf(pend ?? t) }} />
    {shown != null && <div className="bubble" style={{ left: `clamp(7rem, ${pctOf(shown)}, calc(100% - 7rem))` }}>
      {previewSrc && <canvas ref={canvas} width={320} height={180} />}
      <b>{fmt(shown)}</b>{pend != null && <small>{pend >= t ? '+' : '−'}{fmt(Math.abs(pend - t))}</small>}</div>}
  </div>;
}

export default function Player({ source, title, subtitle, actions, thumb, onClose, volume = 0.8, resume = true, saveProgress = true, cues = [] }: Props) {
  const { s: prefs, save: savePrefs, setOverlay } = useApp();
  const wrap = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), playBtn = useRef<HTMLButtonElement>(null), eng = useRef<Engine | null>(null);
  const [t, setT] = useState(0), [d, setD] = useState(0), [state, setState] = useState<'loading' | 'playing' | 'paused' | 'buffering' | 'ended'>('loading');
  const [err, setErr] = useState<{ msg: string; url?: string } | null>(null), [attempt, setAttempt] = useState(0), [muted, setMuted] = useState(false), [rate, setRate] = useState(1);
  const [hidden, setHidden] = useState(false), [osd, setOsd] = useState(''), [started, setStarted] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]), [track, setTrack] = useState<Track | null>(null), [cueText, setCueText] = useState('');
  const [scrub, setScrub] = useState(false), [buf, setBuf] = useState(0); const scrubRef = useRef(false);
  const [menu, setMenu] = useState<null | 'main' | 'subs' | 'size' | 'speed' | 'picture' | 'timing' | 'quality'>(null);
  const subSize = (prefs as any).subSize || 'm', fill = (prefs as any).picture === 'fill', ytQ: string = (prefs as any).ytQuality || 'auto';
  const [nowQ, setNowQ] = useState('');
  const yt = source.kind === 'youtube';
  const remote = source.kind === 'remote';
  const direct = source.kind === 'direct';
  const iframe = source.kind === 'iframe';
  const ref = yt ? `yt:${source.id}` : direct ? `direct:${source.url}` : remote ? `remote:${source.url}` : iframe ? `iframe:${source.url}` : `local:${source.id}`;
  const last = useRef(0), hideT = useRef<any>(), osdT = useRef<any>(), resumeAt = useRef<number | null>(null), tRef = useRef(0), dRef = useRef(0), stRef = useRef(state); stRef.current = state;
  useBack(() => menu ? setMenu(menu === 'main' ? null : 'main') : onClose());
  useEffect(() => { setOverlay(true); return () => setOverlay(false); }, []); // eslint-disable-line
  const save = (force = false) => { if (!saveProgress) return; const tt = tRef.current, dd = dRef.current; if (!dd || tt < 1 || (!force && Date.now() - last.current < 10000)) return; last.current = Date.now(); put('/progress', { ref, pos: tt, dur: dd, title, mode: yt ? 'youtube' : (remote || direct) ? 'stream' : 'mymedia' }).catch(() => {}); };
  const wake = () => { setHidden(false); clearTimeout(hideT.current); hideT.current = setTimeout(() => setHidden(h => stRef.current === 'playing' && !menuRef.current && !scrubRef.current ? true : h), 3500); };
  const menuRef = useRef(menu); menuRef.current = menu;
  const flash = (x: string) => { setOsd(x); clearTimeout(osdT.current); osdT.current = setTimeout(() => setOsd(''), 1000); };

  useEffect(() => {
    if (!stage.current) return; setErr(null); setState('loading'); setStarted(false); setTracks([]); setTrack(null);
    const tryResume = (dd: number) => { const r = resumeAt.current; if (r == null || !dd) return; resumeAt.current = null; if (r < dd - 10) { eng.current?.seek(r); tRef.current = r; setT(r); flash(`Resumed at ${fmt(r)}`); } };
    const wantLang = (prefs as any).subLang || '';
    const ev: Ev = {
      onTime: (tt, dd) => { if (dd) { dRef.current = dd; setD(dd); tryResume(dd); } tRef.current = tt; setT(tt); setBuf(eng.current?.buffered() || 0); save(); },
      onReady: dd => { if (dd) { dRef.current = dd; setD(dd); tryResume(dd); } },
      onState: st => { setState(st); if (st === 'playing') { setStarted(true); wake(); } else { setHidden(false); if (st !== 'buffering') save(true); } },
      onError: (msg, url) => setErr({ msg, url }),
      onTracks: list => { setTracks(list); setTrack(cur => cur ?? (wantLang ? list.find(x => x.lang === wantLang && !x.auto) || list.find(x => x.lang === wantLang) || null : null)); },
    };
    const e = yt ? youtubeEngine(stage.current, source.id, ev, volume, wantLang, SIZES.find(x => x[0] === subSize)?.[2] ?? 0, ytQ) 
      : direct ? directEngine(stage.current, source.url, source.type, ev, volume)
      : remote ? directEngine(stage.current, source.url, 'mp4', ev, volume)
      : iframe ? iframeEngine(stage.current, source.url, ev) 
      : fileEngine(stage.current, source.id, ev, volume, attempt);
    eng.current = e; const r = stage.current.getBoundingClientRect(); e.layout(r.width, r.height, fill, ytQ);
    if (yt) api<{ tracks: any[] }>(`/ytcaptions?id=${encodeURIComponent(source.id)}`, {}, 1)
      .then(x => { if (x.tracks.length) ev.onTracks(x.tracks.map(t => ({ id: t.id, lang: t.lang, label: t.label, auto: t.auto }))); else e.nativeCaptions?.(); })
      .catch(() => e.nativeCaptions?.());
    if (resume && !iframe) api(`/progress?ref=${encodeURIComponent(ref)}`).then(p => { if (p && p.pos > 5 && p.pos < p.dur - 10) { resumeAt.current = p.pos; if (dRef.current) tryResume(dRef.current); } }).catch(() => {});
    if (!iframe) playBtn.current?.focus();
    const ap = setTimeout(() => { if (stRef.current === 'loading') setState('paused'); }, 8000);
    return () => { save(true); e.destroy(); eng.current = null; clearTimeout(hideT.current); clearTimeout(ap); };
  }, [ref, attempt]); // eslint-disable-line
  useLayoutEffect(() => { const el = stage.current; if (!el) return; const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); eng.current?.layout(r.width, r.height, fill, ytQ); }); ro.observe(el); const r = el.getBoundingClientRect(); eng.current?.layout(r.width, r.height, fill, ytQ); return () => ro.disconnect(); }, [fill, attempt, ytQ]);
  
  // Render external cues (from Wing.st) if present
  useEffect(() => {
    if (!cues.length) { setCueText(''); return; }
    let raf = 0;
    const tick = () => {
      const now = eng.current?.time() || 0;
      const act = cues.filter(c => c.a <= now && c.b >= now).map(c => c.text).join('\n');
      setCueText(x => x === act ? x : act);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues]);

  useEffect(() => { if (yt) eng.current?.setSubSize(SIZES.find(x => x[0] === subSize)?.[2] ?? 0); }, [subSize]); // eslint-disable-line

  const toggle = () => { const e = eng.current; if (!e) return; if (state === 'ended') { e.seek(0); e.play(); } else if (state === 'playing' || state === 'buffering') e.pause(); else e.play(); wake(); };
  const skip = (x: number) => { const e = eng.current; if (!e) return; const n = Math.max(0, Math.min(dRef.current || Infinity, e.time() + x)); e.seek(n); tRef.current = n; setT(n); flash(`${x > 0 ? '+' : '−'}${Math.abs(x)}s  ${fmt(n)}`); wake(); };
  const mute = () => { const n = !muted; setMuted(n); eng.current?.setMuted(n); flash(n ? 'Muted' : 'Sound on'); };
  const full = () => document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen().catch(() => {});
  const pickTrack = (tr: Track | null) => { setTrack(tr); savePrefs({ subLang: tr ? tr.lang || '' : '' } as any); flash(tr ? `Subtitles: ${tr.label}` : 'Subtitles off'); };
  const ccToggle = () => { if (!tracks.length) { flash('No subtitles for this video'); return; } if (track) pickTrack(null); else pickTrack(tracks.find(x => x.lang === ((prefs as any).subLang || 'en')) || tracks.find(x => x.lang === 'en') || tracks[0]); };
  const setSpeed = (r: number) => { setRate(r); eng.current?.setRate(r); flash(`Speed ${r}×`); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!eng.current || err) return;
      const wasHidden = hidden; wake();
      if (menu) return;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === ' ' && (document.activeElement as HTMLElement)?.classList.contains('seekbar') && scrubRef.current) return;
      if (e.key === ' ' || e.key === 'MediaPlayPause' || e.key === 'k') { toggle(); stop(); return; }
      if (e.key === 'MediaFastForward') { skip(30); stop(); return; } if (e.key === 'MediaRewind') { skip(-10); stop(); return; }
      if (wasHidden && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) { if (!wrap.current?.contains(document.activeElement)) playBtn.current?.focus(); stop(); return; }
      if (e.key === 'm') mute(); else if (e.key === 'f') full(); else if (e.key === 'c') ccToggle(); else if (e.key === 's') setMenu('main'); else if (e.key === 'j') skip(-10); else if (e.key === 'l') skip(30);
    };
    addEventListener('keydown', h, true); return () => removeEventListener('keydown', h, true);
  });
  useEffect(() => { if (err || state === 'ended') setTimeout(() => wrap.current?.querySelector<HTMLElement>('.msg .btn')?.focus(), 30); }, [err, state === 'ended']); // eslint-disable-line
  useEffect(() => { if (menu) { setHidden(false); setTimeout(() => wrap.current?.querySelector<HTMLElement>('.psettings [data-autofocus], .psettings button')?.focus(), 20); } else if (menu === null && !iframe) playBtn.current?.focus(); }, [menu]); // eslint-disable-line

  useEffect(() => { if (!menu || !yt) return; const tick = () => setNowQ(eng.current?.quality?.() || ''); tick(); const t = setInterval(tick, 1000); return () => clearInterval(t); }, [menu]); // eslint-disable-line
  const playing = state === 'playing' || state === 'buffering';
  const sizeLabel = SIZES.find(x => x[0] === subSize)?.[1] || 'Medium';
  const opt = (key: any, on: boolean, children: ReactNode, onClick: () => void) => <button key={key} data-nav data-autofocus={on || undefined} className={'popt' + (on ? ' on' : '')} onClick={onClick}><span className="tick">{on ? Icon.check : null}</span>{children}</button>;
  const row = (label: string, value: string, to: typeof menu) => <button key={label} data-nav className="prow" onClick={() => setMenu(to)}><span>{label}</span><span className="val">{value} ›</span></button>;
  
  const panel = menu && !iframe && <div className="psettings" data-modal role="dialog" aria-label="Video settings" onClick={e => e.stopPropagation()}>
    {menu === 'main' && <><h3>Video settings</h3>
      {row('Subtitles', track ? track.label : tracks.length ? 'Off' : 'None available', 'subs')}
      {row('Subtitle size', sizeLabel, 'size')}
      {row('Speed', rate === 1 ? 'Normal' : `${rate}×`, 'speed')}
      {row('Picture', fill ? 'Fill screen' : 'Fit to screen', 'picture')}
      {yt && row('Quality', `${(QUALITIES.find(x => x[0] === ytQ)?.[1] || 'Auto').replace(/ \(.*\)/, '')}${nowQ ? ` · playing ${nowQ}` : ''}`, 'quality')}
      {!yt && <p className="pnote">Your own files always play at their original quality.</p>}</>}
    {menu === 'subs' && <><h3>Subtitles</h3>
      {opt('off', !track, 'Off', () => { pickTrack(null); setMenu('main'); })}
      {tracks.map(x => opt(x.id, track?.id === x.id, x.label, () => { pickTrack(x); setMenu('main'); }))}
      {!tracks.length && <p className="pnote">{yt ? 'This video has no captions.' : 'No subtitle files found.'}</p>}</>}
    {menu === 'size' && <><h3>Subtitle size</h3>{SIZES.map(([k, l]) => opt(k, subSize === k, l, () => { savePrefs({ subSize: k } as any); setMenu('main'); }))}</>}
    {menu === 'speed' && <><h3>Speed</h3>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].filter(r => eng.current?.rates().includes(r) ?? true).map(r => opt(r, rate === r, r === 1 ? 'Normal' : `${r}×`, () => { setSpeed(r); setMenu('main'); }))}</>}
    {menu === 'quality' && <><h3>Quality</h3>
      {QUALITIES.map(([k, l]) => opt(k, ytQ === k, l, () => { savePrefs({ ytQuality: k } as any); flash(`Quality: ${l.replace(/ \(.*\)/, '')}`); setMenu('main'); }))}
      <p className="pnote">{nowQ ? `Playing ${nowQ} right now. ` : ''}YouTube switches to the chosen quality within a few seconds.</p></>}
    {menu === 'picture' && <><h3>Picture</h3>
      {opt('fit', !fill, 'Fit to screen', () => { savePrefs({ picture: 'fit' } as any); setMenu('main'); })}
      {opt('fill', fill, 'Fill screen (crops edges)', () => { savePrefs({ picture: 'fill' } as any); setMenu('main'); })}</>}
  </div>;

  return <div ref={wrap} className={'overlay player' + (hidden && !err && !menu && !iframe ? ' hide' : '')} data-modal onMouseMove={wake} data-subsize={subSize}>
    <div ref={stage} className={'stage' + (yt ? ' yt' : '')} />
    {yt && !started && <div className="cover" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />}
    {!iframe && <div className="shield" onClick={() => menu ? setMenu(null) : toggle()} onDoubleClick={full} />}
    {cueText && !iframe && <div className="subs" dangerouslySetInnerHTML={{ __html: cueHtml(cueText) }} />}
    {osd && !iframe && <div className="osd">{osd}</div>}
    {(state === 'loading' || state === 'buffering') && !err && !iframe && <div className="msg"><div className="spinner" aria-label="Loading" /></div>}
    {state === 'ended' && !err && !iframe && <div className="msg ended"><div><h2>{title}</h2><div className="row"><Btn primary icon={Icon.refresh} onClick={toggle}>Watch again</Btn><Btn icon={Icon.back} onClick={onClose}>Back</Btn></div></div></div>}
    {err && <div className="msg"><div><h2>Can't play “{title}”</h2><p>{err.msg}</p><div className="row">
      {!yt || !err.url ? <Btn primary onClick={() => setAttempt(x => x + 1)}>Try again</Btn> : <Btn primary onClick={() => window.open(err.url, '_blank')}>Open on YouTube</Btn>}
      <Btn onClick={onClose}>Back</Btn></div></div></div>}
    
    <div className="chrome" {...(menu ? { inert: '' } : {}) as any}>
      <div className="ptop"><Btn icon={Icon.back} onClick={onClose}>Back</Btn><div className="ptitle"><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>{actions}</div>
      {!err && state !== 'ended' && !iframe && <div className="pbottom">
        <SeekBar t={t} d={d} buf={buf} onScrub={on => { scrubRef.current = on; setScrub(on); wake(); }} previewSrc={yt || remote || direct ? undefined : `/api/library/file/${(source as any).id}?preview`} onCommit={n => { eng.current?.seek(n); tRef.current = n; setT(n); flash(`Jumped to ${fmt(n)}`); wake(); }} />
        <div className="times"><span>{fmt(t)}</span>{scrub ? <span className="hint">OK to jump · Back to cancel</span> : <span />}<span>−{fmt(Math.max(0, d - t))}</span></div>
        <div className="row">
          <button data-nav className="iconbtn" aria-label="Back 10 seconds" onClick={() => skip(-10)}>{Icon.rew}</button>
          <button ref={playBtn} data-nav className="iconbtn big" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? Icon.pause : Icon.play}</button>
          <button data-nav className="iconbtn" aria-label="Forward 30 seconds" onClick={() => skip(30)}>{Icon.fwd}</button>
          <div className="spacer" />
          <button data-nav className={'iconbtn cc' + (track || cues.length ? ' on' : '')} aria-label="Subtitles" title="Subtitles (C)" onClick={ccToggle}>CC</button>
          <button data-nav className="iconbtn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={mute}>{muted ? Icon.mute : Icon.volume}</button>
          <button data-nav className="iconbtn" aria-label="Video settings" title="Video settings (S)" onClick={() => setMenu('main')}>{Glyph.settings}</button>
          <button data-nav className="iconbtn" aria-label="Full screen" onClick={full}>{Icon.full}</button>
        </div>
      </div>}
    </div>
    {panel}
  </div>;
}
