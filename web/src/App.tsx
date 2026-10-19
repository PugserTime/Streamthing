import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, put, img } from './api';
import { Glyph, Logo, Icon, Shelf, useAsync, useAutoFocus, useIdleCursor, useSpatialNav, setRootBack, Progress, hue, prettyName } from './ui';
import '@fontsource-variable/lexend';
import './style.css';

const modes = { youtube: lazy(() => import('./modes/YouTube')), streaming: lazy(() => import('./modes/Streaming')), mymedia: lazy(() => import('./modes/MyMedia')), settings: lazy(() => import('./modes/Settings')) };
export type Mode = 'home' | keyof typeof modes;
export const defaultSettings = { accent: '#8f78ff', theme: 'dark', textSize: 'normal', startMode: 'launcher', lastMode: null as Mode | null, volume: 0.8, resume: true, fullscreenOnLaunch: false, debugOverlay: false, subLang: '', subSize: 'm', picture: 'fit' };
export type Settings = typeof defaultSettings;
export type Art = { img?: string; color?: string } | null;
type Ctx = { s: Settings; save: (p: Partial<Settings>) => void; open: (m: Mode, intent?: any) => void; intent: any; setArt: (a: Art) => void; status: any; refreshStatus: () => void; setOverlay: (on: boolean) => void };
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const APPS: { id: keyof typeof modes; label: string; sub: string; c: string; blurb: string }[] = [
  { id: 'youtube', label: 'YouTube', sub: 'Trending, search, saved', c: 'var(--yt)', blurb: 'What\'s trending right now, plus everything you\'ve saved and watched.' },
  { id: 'streaming', label: 'Streaming', sub: 'Movies & TV', c: 'var(--st)', blurb: 'Browse what\'s popular, read about it, and watch the trailer.' },
  { id: 'mymedia', label: 'My Media', sub: 'Videos on this PC', c: 'var(--mm)', blurb: 'Your own video files, picked up from the folders you choose.' },
  { id: 'settings', label: 'Settings', sub: 'Keys, look, system', c: 'var(--se)', blurb: 'Add your TMDB and YouTube keys, change the look, check the system.' }];
const TABS: [Mode, string][] = [['home', 'Home'], ['youtube', 'YouTube'], ['streaming', 'Streaming'], ['mymedia', 'My Media'], ['settings', 'Settings']];

export default function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>('home'); const [intent, setIntent] = useState<any>(null);
  const [art, setArt] = useState<Art>(null); const [overlay, setOverlay] = useState(false);
  const status = useAsync(() => api('/status'), []);
  useEffect(() => { api('/settings').then(r => { const v = { ...defaultSettings, ...r }; if (r.density === 'large') v.textSize = 'large'; setS(v); if (v.startMode === 'last' && v.lastMode) setMode(v.lastMode); }).catch(() => setS(defaultSettings)); }, []);
  useEffect(() => { if (!s) return; const d = document.documentElement; d.style.setProperty('--accent', s.accent); d.dataset.theme = s.theme; d.dataset.textsize = s.textSize; }, [s]);
  const save = useCallback((p: Partial<Settings>) => setS(cur => { const n = { ...cur!, ...p }; put('/settings', n).catch(() => {}); return n; }), []);
  const open = useCallback((m: Mode, it: any = null) => { setIntent(it); setMode(m); setArt(null); setOverlay(false); if (m !== 'home') save({ lastMode: m }); }, [save]);
  useEffect(() => setRootBack(() => { if (mode !== 'home') open('home', { focus: mode }); }), [mode, open]);
  useSpatialNav(); useIdleCursor();
  // Warm up YouTube in the background shortly after start, so the first video opens faster.
  useEffect(() => { if (!status.data?.youtube) return; const go = () => import('./Player').then(m => { m.loadYT().catch(() => {}); (customElements.get('lite-youtube') as any)?.warmConnections?.(); }).catch(() => {});
    const w = window as any; const id = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 2500); return () => { w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id); }; }, [status.data?.youtube]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'F2') { e.preventDefault(); save({ debugOverlay: !s?.debugOverlay }); } }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [s?.debugOverlay, save]);
  const ctx = useMemo(() => s && ({ s, save, open, intent, setArt, status: status.data, refreshStatus: status.retry, setOverlay }), [s, save, open, intent, status.data]); // eslint-disable-line
  if (!ctx) return <div className="center">Loading…</div>;
  const M = mode === 'home' ? Home : modes[mode];
  return <AppCtx.Provider value={ctx}>
    <div className="shell">
      <Ambient art={art} />
      {ctx.s.debugOverlay && <DebugOverlay />}
      <div data-zone="top" {...(overlay ? { inert: "" } : {}) as any} style={{ position: "relative", zIndex: 5, visibility: overlay ? "hidden" : undefined }}><TopBar mode={mode} open={open} /></div>
      <div className="view" data-scroll key={mode + (intent ? JSON.stringify(intent) : '')}>
        <Suspense fallback={<div className="center">Loading…</div>}><M /></Suspense>
      </div>
    </div>
  </AppCtx.Provider>;
}

// Backdrop that follows whatever is focused. Two layers crossfade.
function Ambient({ art }: { art: Art }) {
  const [layers, setLayers] = useState<[Art, Art]>([null, null]); const [top, setTop] = useState(0);
  const key = art ? art.img || art.color : '';
  useEffect(() => { const t = setTimeout(() => { setLayers(l => { const n = [...l] as [Art, Art]; n[1 - top] = art; return n; }); setTop(x => 1 - x); }, art?.img ? 180 : 60); return () => clearTimeout(t); }, [key]); // eslint-disable-line
  const bg = (a: Art) => a?.img ? { backgroundImage: `url(${a.img})` } : a?.color ? { background: `radial-gradient(80% 90% at 85% 10%, color-mix(in srgb, ${a.color} 55%, transparent), transparent 70%)` } : {};
  return <div className="ambient">{layers.map((a, i) => <div key={i} className={i === top && a ? 'on' : ''} style={bg(a)} />)}</div>;
}

function TopBar({ mode, open }: { mode: Mode; open: (m: Mode) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  const [fs, setFs] = useState(!!document.fullscreenElement);
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); addEventListener('fullscreenchange', h); return () => removeEventListener('fullscreenchange', h); }, []);
  return <header className="topbar">
    <div className="brand"><Logo />Media Center</div>
    <nav className="tabs" data-navgroup>{TABS.map(([m, l]) => <button key={m} data-nav data-active={m === mode || undefined} className={'tab' + (m === mode ? ' on' : '')} onClick={() => open(m)}>{l}</button>)}</nav>
    <div className="spacer" />
    <div className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
    <button data-nav className="iconbtn" title={fs ? 'Exit full screen' : 'Full screen'} aria-label="Full screen" onClick={() => fs ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})}>{Icon.full}</button>
  </header>;
}

function Home() {
  const { open, setArt, intent, status } = useApp();
  const prog = useAsync(() => api<any[]>('/progress'), []);
  const yt = useAsync(() => api<any[]>('/lists?kind=ytsaved'), []);
  const favs = useAsync(() => api<any[]>('/lists?kind=favorite'), []);
  const later = useAsync(() => api<any[]>('/lists?kind=watchlater'), []);
  const [feat, setFeat] = useState<{ title: string; sub: string }>({ title: 'Good to see you', sub: 'Pick something to watch.' });
  const focus = (title: string, sub: string, art: Art) => { setFeat({ title, sub }); setArt(art); };
  const cont = (prog.data || []).filter(p => (p.mode === 'mymedia' || p.mode === 'youtube') && p.pos > 10 && p.pos / p.dur < 0.95).slice(0, 12);
  const keysMissing = status && (!status.tmdb || !status.youtube);
  useAutoFocus(prog.loading);
  useEffect(() => { const h = new Date().getHours(); setFeat({ title: h < 5 ? 'Late one tonight' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', sub: keysMissing ? 'Add your TMDB and YouTube keys in Settings to fill this screen with things to watch.' : 'Pick something to watch.' }); }, [keysMissing]);
  return <div className="browse home">
    <div className="hero"><h1>{feat.title}</h1><p className="sub">{feat.sub}</p></div>
    <div className="rows" data-scroll>
    <Shelf title="Apps">{APPS.map(a => <button key={a.id} data-nav data-autofocus={(intent?.focus ? intent.focus === a.id : a.id === 'youtube') || undefined} className="app" style={{ ['--c' as any]: a.c }}
      onFocus={() => focus(a.label, a.blurb, { color: a.c })} onClick={() => open(a.id)}>{Glyph[a.id]}<b>{a.label}</b><span>{a.sub}</span></button>)}</Shelf>
    <Shelf title="Continue watching" show={cont.length > 0}>{cont.map(p => { const left = `${Math.max(1, Math.round((p.dur - p.pos) / 60))} min left`;
      if (p.mode === 'youtube') { const id = String(p.ref).slice(3), th = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; return <button key={p.ref} data-nav className="thumb" onFocus={() => focus(p.title, `YouTube · ${left}`, { img: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` })} onClick={() => open('youtube', { video: { id, title: p.title, channel: '', thumb: th } })}>
        <div className="pic"><img src={th} alt="" loading="lazy" /><Progress p={p.pos / p.dur} /></div><b>{p.title}</b></button>; }
      const name = prettyName(p.title || p.ref); return <button key={p.ref} data-nav className="file" style={{ ['--h' as any]: hue(name) }}
      onFocus={() => focus(name, `My Media · ${left}`, { color: `hsl(${hue(name)} 60% 45%)` })}
      onClick={() => open('mymedia', { play: +String(p.ref).split(':')[1] })}><span className="mono">{name.slice(0, 2)}</span><b>{name}</b><Progress p={p.pos / p.dur} /></button>; })}</Shelf>
    <Shelf title="Saved from YouTube" show={(yt.data?.length ?? 0) > 0}>{yt.data?.map(v => <button key={v.ref} data-nav className="thumb" onFocus={() => focus(v.title, v.channel || 'YouTube', { img: v.thumb?.replace('mqdefault', 'maxresdefault') })} onClick={() => open('youtube', { video: v })}>
      <div className="pic"><img src={v.thumb} alt="" loading="lazy" /></div><b>{v.title}</b></button>)}</Shelf>
    {[['Your favorites', favs], ['Watch later', later]].map(([t, l]: any) => <Shelf key={t} title={t} show={(l.data?.length ?? 0) > 0}>{l.data?.map((f: any) => <button key={f.ref} data-nav className="poster"
      onFocus={() => focus(f.title, 'Movie & TV · from Streaming', f.backdrop ? { img: img(f.backdrop, 'w1280') } : { color: 'var(--st)' })} onClick={() => open('streaming', { detail: { id: f.id, type: f.type } })}>
      {f.poster ? <img src={img(f.poster, 'w342')} alt={f.title} loading="lazy" /> : <span className="noart">{f.title}</span>}</button>)}</Shelf>)}
    </div>
  </div>;
}

// ---------- debug overlay (Settings → System, or F2) ----------
const MB = (b?: number | null) => b == null ? '—' : b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${Math.round(b / 1048576)} MB`;
function DebugOverlay() {
  const [d, setD] = useState<any>(null); const [fps, setFps] = useState(0); const [err, setErr] = useState('');
  const hist = useState<number[]>([])[0];
  useEffect(() => { let on = true; const tick = async () => { try { const r = await fetch('/api/debug').then(r => r.json()); if (on) { setD(r); setErr(''); hist.push((r.rss || 0) + (r.windowMem || 0)); if (hist.length > 60) hist.shift(); } } catch { if (on) setErr('server not responding'); } };
    tick(); const t = setInterval(tick, 2000); return () => { on = false; clearInterval(t); }; }, []); // eslint-disable-line
  useEffect(() => { let n = 0, last = performance.now(), raf = 0; const f = (t: number) => { n++; if (t - last >= 1000) { setFps(Math.round(n * 1000 / (t - last))); n = 0; last = t; } raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  const pm = (performance as any).memory; const dom = document.getElementsByTagName('*').length;
  const total = d ? d.rss + (d.windowMem || 0) : null; const net = d?.net;
  const max = Math.max(1, ...hist), min = Math.min(...hist, max);
  const pts = hist.map((v, i) => `${(i / 59) * 100},${20 - ((v - min) / (max - min || 1)) * 18 - 1}`).join(' ');
  return <aside className="debug" aria-hidden>
    <div className="dbg-head"><b>App RAM {MB(total)}{d && d.windowMem == null ? <small> server only</small> : null}</b><span>F2 to hide</span></div>
    {hist.length > 1 && <svg viewBox="0 0 100 20" preserveAspectRatio="none"><polyline points={pts} /></svg>}
    {err && <p className="dbg-bad">{err}</p>}
    {d && <dl>
      <dt>Server</dt><dd>{MB(d.rss)} RSS · heap {MB(d.heapUsed)}/{MB(d.heapTotal)} · CPU {d.cpu.toFixed(1)}%</dd>
      <dt>Window</dt><dd>{d.windowMem != null ? `${MB(d.windowMem)} · ${d.windowProcs} Edge processes` : 'not measured here (Edge app window on Windows only)'}</dd>
      <dt>Page</dt><dd>{pm ? `JS heap ${MB(pm.usedJSHeapSize)}/${MB(pm.totalJSHeapSize)} · ` : ''}{fps} fps · {dom.toLocaleString()} elements</dd>
      <dt>Network</dt><dd>{net.requests} calls · {net.cacheHits} from cache · {net.retries} retries · {net.failures} failed{net.staleServed ? ` · ${net.staleServed} offline copies` : ''} · last {net.lastMs} ms</dd>
      <dt>Server lag</dt><dd>{d.loopMeanMs.toFixed(1)} ms avg · {d.loopMaxMs.toFixed(1)} ms max</dd>
      <dt>PC</dt><dd>{MB(d.totalMem - d.freeMem)} of {MB(d.totalMem)} used · {d.cores} cores · up {Math.floor(d.uptime / 60)} min</dd>
      {net.lastError && <><dt>Last error</dt><dd className="dbg-bad">{new Date(net.lastError.at).toLocaleTimeString()} — {String(net.lastError.message).slice(0, 140)}</dd></>}
    </dl>}
  </aside>;
}
