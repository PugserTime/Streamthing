import { ReactNode, useEffect, useRef, useState } from 'react';
import { api, post, del, fmt } from '../api';
import { useApp } from '../App';
import Player, { loadYT } from '../Player';
import { Btn, ErrorNotice, Icon, Notice, Progress, SkeletonLane, useAsync, useAutoFocus, useBack, useRestoreFocus } from '../ui';

export type V = { id: string; title: string; channel: string; channelId?: string; channelThumb?: string; thumb: string; dur?: number | string; live?: boolean; views?: number; published?: string | null };
type Page = { items: V[]; next?: string | null };

// ---------- sidebar ----------
const I = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
type Sec = { id: string; label: string; icon: ReactNode; cat?: string; trending?: boolean };
const MAIN: Sec[] = [
  { id: 'home', label: 'Home', icon: I(<path d="M4 11l8-6.5 8 6.5V20h-5.5v-5h-5v5H4z" />) },
  { id: 'trending', label: 'Trending', trending: true, icon: I(<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.6 2.2 3C10.6 9 11.2 5.8 12 3z" />) },
];
const CATS: Sec[] = [
  { id: 'music', label: 'Music', cat: '10', icon: I(<><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>) },
  { id: 'gaming', label: 'Gaming', cat: '20', icon: I(<><path d="M7 8h10a4 4 0 0 1 4 4l.5 4a2.5 2.5 0 0 1-4.4 1.8L15 15H9l-2.1 2.8A2.5 2.5 0 0 1 2.5 16L3 12a4 4 0 0 1 4-4z" /><path d="M7.5 11v3M6 12.5h3" /><circle cx="16" cy="11.5" r=".6" fill="currentColor" /><circle cx="17.5" cy="13.5" r=".6" fill="currentColor" /></>) },
  { id: 'sports', label: 'Sports', cat: '17', icon: I(<><path d="M8 4h8v4a4 4 0 0 1-8 0z" /><path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4M12 12v4M9 20h6M10 16h4" /></>) },
  { id: 'news', label: 'News', cat: '25', icon: I(<><rect x="3.5" y="5" width="14" height="14" rx="1.5" /><path d="M17.5 9h3v8.5A1.5 1.5 0 0 1 19 19M7 9h7M7 12.5h7M7 16h4" /></>) },
  { id: 'film', label: 'Movies & animation', cat: '1', icon: I(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4" /></>) },
  { id: 'comedy', label: 'Comedy', cat: '23', icon: I(<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14a4 4 0 0 0 7 0M9 10h.01M15 10h.01" /></>) },
  { id: 'ent', label: 'Entertainment', cat: '24', icon: I(<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />) },
  { id: 'science', label: 'Science & tech', cat: '28', icon: I(<><circle cx="12" cy="12" r="1.6" fill="currentColor" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></>) },
  { id: 'learn', label: 'Learning', cat: '27', icon: I(<><path d="M2.5 9.5L12 5l9.5 4.5L12 14z" /><path d="M6.5 11.5V16c3 2.5 8 2.5 11 0v-4.5M21.5 9.5v5" /></>) },
  { id: 'howto', label: 'How-to & style', cat: '26', icon: I(<><path d="M14.5 5.5l4 4L9 19H5v-4z" /><path d="M12.5 7.5l4 4" /></>) },
  { id: 'autos', label: 'Cars', cat: '2', icon: I(<><path d="M5 16V12l2-4.5h10L19 12v4" /><path d="M3.5 16h17M5 12h14" /><circle cx="7.5" cy="16.5" r="1.7" /><circle cx="16.5" cy="16.5" r="1.7" /></>) },
  { id: 'pets', label: 'Pets & animals', cat: '15', icon: I(<><circle cx="7" cy="10" r="1.7" /><circle cx="10.5" cy="6.5" r="1.7" /><circle cx="14.5" cy="6.5" r="1.7" /><circle cx="18" cy="10" r="1.7" /><path d="M8.5 17c0-3 1.6-5 3.5-5s3.5 2 3.5 5a2 2 0 0 1-2.4 2c-.7-.2-.8-.4-1.1-.4s-.4.2-1.1.4A2 2 0 0 1 8.5 17z" /></>) },
  { id: 'travel', label: 'Travel', cat: '19', icon: I(<path d="M10.5 13.5L4 11l1.2-1.2 7.3.8 4-4c.8-.8 2.2-1 2.8-.4s.4 2-.4 2.8l-4 4 .8 7.3L14.5 21 12 14.5l-3 3V20l-1 1-1.4-3.6L3 16l1-1h2.5z" />) },
];
const YOU: Sec[] = [
  { id: 'saved', label: 'Saved', icon: Icon.bookmark },
  { id: 'history', label: 'History', icon: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>) },
];
const ALL = [...MAIN, ...CATS, ...YOU];

// ---------- formatting ----------
const region = (() => { try { const r = (navigator.language || 'en-US').split('-')[1]; return /^[A-Z]{2}$/.test(r || '') ? r : 'US'; } catch { return 'US'; } })();
const lang = (navigator.language || 'en').split('-')[0];
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const ago = (iso?: string | null) => { if (!iso) return ''; const s = (Date.now() - Date.parse(iso)) / 1000; const u: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]; for (const [n, l] of u) if (s >= n) { const k = Math.floor(s / n); return `${k} ${l}${k > 1 ? 's' : ''} ago`; } return 'just now'; };
const durText = (d?: number | string) => typeof d === 'number' ? (d ? fmt(d) : '') : (d || '');
const sub = (v: V) => [v.views ? `${compact.format(v.views)} views` : '', ago(v.published)].filter(Boolean).join(' · ');
const fromItem = (x: any): V => ({ id: x.id || x.ref, title: x.title, channel: x.channel || '', channelId: x.channelId, channelThumb: x.channelThumb, thumb: x.thumb || `https://i.ytimg.com/vi/${x.id || x.ref}/hqdefault.jpg`, dur: x.dur, views: x.views, published: x.published, live: x.live });

// Loads only when scrolled near, to save YouTube quota.
function useNear<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [near, setNear] = useState(false);
  useEffect(() => { const el = ref.current; if (!el || near) return; const root = el.closest('[data-scroll]'); const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) setNear(true); }, { root, rootMargin: '600px 0px' }); io.observe(el); return () => io.disconnect(); }, [near]);
  return [ref, near] as const;
}

export default function YouTube() {
  const { s, status, intent, open, setArt, setOverlay } = useApp();
  const [sec, setSec] = useState<string>('home'); const [q, setQ] = useState(''), [sq, setSq] = useState(''), [order, setOrder] = useState('relevance');
  const [vid, setVid] = useState<V | null>(intent?.video ? fromItem(intent.video) : null);
  const saved = useAsync(() => api<any[]>('/lists?kind=ytsaved'), []);
  const hist = useAsync(() => api<any[]>('/lists?kind=ythistory'), []);
  const prog = useAsync(() => api<any[]>('/progress'), []);
  const hasKey = !!status?.youtube;
  const focusT = useRef<any>();
  useEffect(() => { loadYT().catch(() => {}); }, []); // warm up the player so videos start faster
  useEffect(() => { if (vid) post('/lists?kind=ythistory', { ref: vid.id, data: vid }).then(hist.retry).catch(() => {}); }, [vid?.id]); // eslint-disable-line
  useEffect(() => { setOverlay(!!vid); }, [vid]); // eslint-disable-line
  useBack(() => { setSec('home'); setSq(''); }, sec !== 'home' && !vid);
  useAutoFocus(`${vid?.id}-${sec}`); useRestoreFocus(!!vid);
  const isSaved = (id: string) => saved.data?.some(x => x.ref === id);
  const toggleSave = (v: V) => (isSaved(v.id) ? del(`/lists?kind=ytsaved&ref=${encodeURIComponent(v.id)}`) : post('/lists?kind=ytsaved', { ref: v.id, data: v })).then(saved.retry);
  const go = (id: string) => { clearTimeout(focusT.current); if (id !== 'search') setSq(''); setSec(id); document.querySelector('.yt-main')?.scrollTo({ top: 0 }); };
  const pm: Record<string, any> = Object.fromEntries((prog.data || []).map(p => [p.ref, p]));

  const card = (v: V, key: any = v.id, first = false) => { const p = pm[`yt:${v.id}`]; return <button key={key} data-nav data-autofocus={first || undefined} className="thumb ytcard" onFocus={() => setArt({ img: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg` })} onClick={() => setVid(v)}>
    <div className="pic"><img src={v.thumb} alt="" loading="lazy" decoding="async" />{v.live ? <span className="dur live">LIVE</span> : durText(v.dur) && <span className="dur">{durText(v.dur)}</span>}{p && p.pos > 10 && <Progress p={p.pos / p.dur} />}</div>
    <div className="meta">{v.channelThumb ? <img className="avatar" src={v.channelThumb} alt="" loading="lazy" /> : <span className="avatar">{(v.channel || '?').slice(0, 1)}</span>}
      <div><b>{v.title}</b><small>{v.channel}</small>{sub(v) && <small>{sub(v)}</small>}</div></div></button>; };

  const player = vid && <Player source={{ kind: 'youtube', id: vid.id }} title={vid.title} subtitle={vid.channel} thumb={vid.thumb} volume={s.volume} resume={s.resume} onClose={() => { setVid(null); prog.retry(); }}
    actions={<Btn icon={isSaved(vid.id) ? Icon.bookmarkFill : Icon.bookmark} onClick={() => toggleSave(vid)}>{isSaved(vid.id) ? 'Saved' : 'Save'}</Btn>} />;

  const runSearch = () => { const t = q.trim(); if (!t) return; setSq(t); go('search'); };
  const cur = ALL.find(x => x.id === sec);
  const railBtn = (x: Sec) => <button key={x.id} data-nav data-active={sec === x.id || undefined} className={sec === x.id ? 'on' : ''}
    onFocus={() => { clearTimeout(focusT.current); if (x.id !== sec) focusT.current = setTimeout(() => go(x.id), 450); }} onClick={() => go(x.id)}>{x.icon}<span>{x.label}</span></button>;

  return <><div className="yt" {...(vid ? { inert: '' } : {}) as any}>
    <nav className="yt-rail" data-scroll data-navgroup aria-label="YouTube sections">
      {MAIN.map(railBtn)}<hr /><span className="lbl">Explore</span>{CATS.map(railBtn)}<hr /><span className="lbl">You</span>{YOU.map(railBtn)}
    </nav>
    <div className="yt-main" data-scroll data-navregion>
      <div className="yt-search">
        <input data-nav className="field" placeholder={hasKey ? 'Search YouTube' : 'Search needs a YouTube key'} value={q} disabled={!hasKey} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }} />
        <Btn icon={Icon.search} disabled={!hasKey || !q.trim()} onClick={runSearch}>Search</Btn>
      </div>
      {status && !hasKey && <Notice title="Add a YouTube key to browse YouTube" action={<Btn primary autoFocus icon={Icon.key} onClick={() => open('settings', { section: 'keys' })}>Add YouTube key</Btn>}>Videos you've already saved or watched still play without one.</Notice>}
      {sec === 'home' && <Home hasKey={hasKey} card={card} saved={saved.data || []} hist={hist.data || []} prog={prog.data || []} openKeys={() => open('settings', { section: 'keys' })} />}
      {sec === 'search' && <Feed key={`s:${sq}:${order}`} title={`Results for “${sq}”`} load={pg => api<Page>(`/youtube/search?q=${encodeURIComponent(sq)}&order=${order}&region=${region}&lang=${lang}${pg ? `&page=${pg}` : ''}`)} card={card}
        extra={<div className="choices left">{[['relevance', 'Most relevant'], ['date', 'Newest'], ['viewCount', 'Most viewed']].map(([k, l]) => <button key={k} data-nav className={'choice' + (order === k ? ' on' : '')} onClick={() => setOrder(k)}>{l}</button>)}</div>} />}
      {cur && (cur.cat || cur.trending) && hasKey && <Feed key={sec} title={cur.label} icon={cur.icon} load={pg => api<Page>(`/youtube/popular?max=48&region=${region}${cur.cat ? `&cat=${cur.cat}` : ''}${pg ? `&page=${pg}` : ''}`)} card={card} />}
      {sec === 'saved' && <LocalGrid title="Saved" icon={YOU[0].icon} items={(saved.data || []).map(fromItem)} card={card} empty="Videos you save show up here. Press Save while watching." />}
      {sec === 'history' && <LocalGrid title="History" icon={YOU[1].icon} items={(hist.data || []).map(fromItem)} card={card} empty="Videos you watch show up here." />}
    </div>
  </div>{player}</>;
}

function Home({ hasKey, card, saved, hist, prog, openKeys }: { hasKey: boolean; card: (v: V, key?: any, first?: boolean) => JSX.Element; saved: any[]; hist: any[]; prog: any[]; openKeys: () => void }) {
  const cont = prog.filter(p => p.mode === 'youtube' && p.pos > 10 && p.pos / p.dur < 0.95).slice(0, 16).map(p => { const id = String(p.ref).slice(3); const h = hist.find(x => x.ref === id); return h ? fromItem(h) : fromItem({ id, title: p.title }); });
  // "Recommended": newest uploads from the channels you watch and save, plus more like the last thing you watched.
  const chans = [...new Set([...hist, ...saved].map(x => x.channelId).filter(Boolean))].slice(0, 6) as string[];
  const lastTitle = hist[0]?.title as string | undefined;
  const seed = lastTitle ? lastTitle.replace(/[\[\(【].*?[\]\)】]|#\S+|\|.*$|official|video|lyrics?|hd|4k/gi, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ') : '';
  let first = true; const f = () => { const v = first; first = false; return v; };
  return <>
    {cont.length > 0 && <Lane title="Continue watching" items={cont} card={card} first={f()} />}
    {hasKey && chans.length > 0 && <RemoteLane title="From channels you watch" load={() => api<Page>(`/youtube/channels?ids=${chans.join(',')}`)} card={card} first={f()} />}
    {hasKey && <RemoteLane title="Trending" load={() => api<Page>(`/youtube/popular?max=24&region=${region}`)} card={card} first={f()} openKeys={openKeys} />}
    {hasKey && seed.length > 2 && <RemoteLane title={`Because you watched “${lastTitle!.slice(0, 48)}${lastTitle!.length > 48 ? '…' : ''}”`} load={() => api<Page>(`/youtube/search?q=${encodeURIComponent(seed)}&region=${region}&lang=${lang}`).then(r => ({ ...r, items: r.items.filter(v => v.id !== hist[0]?.ref) }))} card={card} />}
    {saved.length > 0 && <Lane title="Saved" items={saved.map(fromItem)} card={card} />}
    {hasKey && CATS.slice(0, 8).map(c => <RemoteLane key={c.id} title={c.label} load={() => api<Page>(`/youtube/popular?max=20&region=${region}&cat=${c.cat}`)} card={card} />)}
    {hist.length > 0 && <Lane title="Watched recently" items={hist.slice(0, 24).map(fromItem)} card={card} />}
  </>;
}
const Lane = ({ title, items, card, first }: { title: string; items: V[]; card: any; first?: boolean }) =>
  <section className="shelf"><h3>{title}</h3><div className="lane">{items.map((v, i) => card(v, v.id, !!first && i === 0))}</div></section>;
function RemoteLane({ title, load, card, first, openKeys }: { title: string; load: () => Promise<Page>; card: any; first?: boolean; openKeys?: () => void }) {
  const [ref, near] = useNear<HTMLElement>();
  const r = useAsync(() => near ? load() : Promise.resolve(null), [near, title]);
  // when the first row arrives and you haven't moved yet, start on its first video instead of the sidebar
  useEffect(() => { if (!first || !r.data?.items?.length) return; const a = document.activeElement as HTMLElement | null; if (!a || a === document.body || a.matches('.yt-rail [data-active]')) setTimeout(() => (ref.current?.querySelector('.ytcard') as HTMLElement | null)?.focus({ preventScroll: true }), 30); }, [r.data]); // eslint-disable-line
  if (r.error && r.error.code !== 'bad_key' && r.error.code !== 'not_configured') return null; // e.g. a category YouTube doesn't chart in this country
  if (r.data && !r.data.items?.length) return null;
  return <section ref={ref} className="shelf"><h3>{title}</h3>
    {r.error ? <ErrorNotice e={r.error} retry={r.retry} openKeys={openKeys} /> : <div className="lane">{!r.data ? <SkeletonLane w="var(--ytw)" ratio="16/9" /> : r.data.items.map((v, i) => card(v, v.id, !!first && i === 0))}</div>}</section>;
}
function Feed({ title, icon, load, card, extra }: { title: string; icon?: ReactNode; load: (page?: string) => Promise<Page>; card: any; extra?: ReactNode }) {
  const [items, setItems] = useState<V[]>([]), [next, setNext] = useState<string | null | undefined>(undefined), [err, setErr] = useState<any>(null), [busy, setBusy] = useState(false);
  const more = async (pg?: string) => { if (busy) return; setBusy(true); setErr(null); try { const r = await load(pg); setItems(x => { const seen = new Set(x.map(v => v.id)); return [...x, ...r.items.filter(v => !seen.has(v.id))]; }); setNext(r.next || null); } catch (e) { setErr(e); } setBusy(false); };
  useEffect(() => { more(); }, []); // eslint-disable-line
  // infinite scroll: fetch the next page when the end of the grid comes near
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = sentinel.current; if (!el || !next || busy) return; const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); more(next); } }, { root: el.closest('[data-scroll]'), rootMargin: '800px 0px' }); io.observe(el); return () => io.disconnect(); }, [next, busy]); // eslint-disable-line
  return <section>
    <div className="ythead">{icon}<h2>{title}</h2>{extra}</div>
    <ErrorNotice e={err} retry={() => more(next || undefined)} />
    {!items.length && busy && <div className="lane"><SkeletonLane w="var(--ytw)" ratio="16/9" /></div>}
    {!items.length && !busy && !err && next !== undefined && <p className="sub">Nothing here right now.</p>}
    <div className="ytgrid">{items.map((v, i) => card(v, v.id, i === 0))}</div>
    {next && <div ref={sentinel} className="center" style={{ minHeight: '6rem' }}>{busy ? 'Loading more…' : ''}</div>}
  </section>;
}
const LocalGrid = ({ title, icon, items, card, empty }: { title: string; icon: ReactNode; items: V[]; card: any; empty: string }) => <section>
  <div className="ythead">{icon}<h2>{title}</h2></div>
  {!items.length ? <p className="sub">{empty}</p> : <div className="ytgrid">{items.map((v, i) => card(v, v.id, i === 0))}</div>}</section>;
