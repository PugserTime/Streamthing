import { providers, getEmbedUrl, DEFAULT_PROVIDER_ID, getNextEnabledProviderId } from '../config/providers';
import { useEffect, useRef, useState } from 'react';
import { api, post, del, img } from '../api';
import { useApp } from '../App';
import Player, { loadYT } from '../Player';
import { Btn, ErrorNotice, Icon, Shelf, SkeletonLane, useAsync, useAutoFocus, useBack, useRestoreFocus } from '../ui';

const SHELVES = [['Trending this week', '/tmdb/trending/all/week', ''], ['Popular movies', '/tmdb/movie/popular', 'movie'], ['Popular TV', '/tmdb/tv/popular', 'tv'], ['In theaters', '/tmdb/movie/now_playing', 'movie'], ['Top rated movies', '/tmdb/movie/top_rated', 'movie'], ['Top rated TV', '/tmdb/tv/top_rated', 'tv']] as const;
const year = (m: any) => (m.release_date || m.first_air_date || '').slice(0, 4);
const kind = (m: any, t: string) => (m.media_type || t) === 'tv' ? 'TV series' : 'Movie';

export default function Streaming() {
  const { status, intent, open, setArt } = useApp();
  const [sel, setSel] = useState<any>(intent?.detail || null);
  const [q, setQ] = useState(''), [sq, setSq] = useState('');
  const [feat, setFeat] = useState<any>(null); const lastOpened = useRef<any>(null);
  const first = useAsync(() => status?.tmdb ? api('/tmdb/trending/all/week') : Promise.resolve(null), [status?.tmdb]);
  const results = useAsync(() => sq ? api(`/tmdb/search/multi?query=${encodeURIComponent(sq)}`) : Promise.resolve(null), [sq]);
  const favs = useAsync(() => api<any[]>('/lists?kind=favorite'), []);
  const later = useAsync(() => api<any[]>('/lists?kind=watchlater'), []);
  useEffect(() => { const m = first.data?.results?.find((x: any) => x.backdrop_path); if (m && !feat) show(m, ''); }, [first.data]); // eslint-disable-line
  const show = (m: any, t: string) => { setFeat({ ...m, _t: m.media_type || t }); setArt(m.backdrop_path ? { img: img(m.backdrop_path, 'w1280') } : { color: 'var(--st)' }); };
  useAutoFocus(`${first.loading}`); useRestoreFocus(!!sel);
  useBack(() => setSq(''), !!sq && !sel);
  const detail = sel && <Detail sel={sel} back={() => setSel(null)} favs={favs} later={later} />;
  const keyErr = first.error?.code === 'bad_key' ? first.error : null;
  if (status && !status.tmdb || keyErr) return <div className="empty" style={{ paddingTop: '18vh' }}><h3>{keyErr ? 'TMDB didn\'t accept the key' : 'Connect TMDB to browse movies and TV'}</h3>
    <p>{keyErr ? keyErr.message : 'TMDB is the free movie database this screen uses for posters, descriptions, cast and trailers. It takes about two minutes to get a key.'}</p>
    <Btn primary autoFocus icon={Icon.key} onClick={() => open('settings', { section: 'keys' })}>Add TMDB key</Btn>{detail}</div>;
  const P = (m: any, t: string, key: any = m.id) => <button key={key} data-nav data-autofocus={lastOpened.current === m.id || undefined} className="poster" onFocus={() => show(m, t)} onClick={() => { lastOpened.current = m.id; setSel({ id: m.id, type: m.media_type || t }); }}>
    {m.poster_path ? <img loading="lazy" decoding="async" src={img(m.poster_path, 'w342')} alt={m.title || m.name} /> : <span className="noart">{m.title || m.name}</span>}</button>;
  const fav = (f: any) => P({ id: f.id, media_type: f.type, title: f.title, poster_path: f.poster, backdrop_path: f.backdrop, overview: f.overview }, f.type, f.ref);
  const hidden = sel ? { inert: '', style: { visibility: 'hidden' } } as any : {};
  return <><div className="browse" {...hidden}>
    <div className="hero">
      {feat ? <><h1>{feat.title || feat.name}</h1>
        <div className="facts">{year(feat) && <span className="fact">{year(feat)}</span>}<span className="fact">{kind(feat, feat._t)}</span>{feat.vote_average > 0 && <span className="fact star">★ {feat.vote_average.toFixed(1)}</span>}</div>
        <p className="sub">{feat.overview}</p></> : <h1>Streaming</h1>}
    </div>
    <div className="rows" data-scroll>
      <div className="searchbar"><input data-nav className="field" placeholder="Search movies and TV" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setSq(q.trim()); }} />
        <Btn icon={Icon.search} onClick={() => setSq(q.trim())}>Search</Btn>{sq && <Btn ghost onClick={() => { setSq(''); setQ(''); }}>Clear</Btn>}</div>
      <ErrorNotice e={first.error} retry={first.retry} openKeys={() => open('settings', { section: 'keys' })} />
      {sq ? <section className="shelf"><h3>Results for “{sq}”</h3><ErrorNotice e={results.error} retry={results.retry} />
        {results.data && !results.data.results?.length && <p className="sub">Nothing found. Try a shorter title.</p>}
        <div className="grid posters">{results.data?.results?.filter((m: any) => m.media_type !== 'person').map((m: any) => P(m, m.media_type))}</div></section>
        : <>
          <Shelf title="Your favorites" show={(favs.data?.length ?? 0) > 0}>{favs.data?.map(fav)}</Shelf>
          <Shelf title="Watch later" show={(later.data?.length ?? 0) > 0}>{later.data?.map(fav)}</Shelf>
          {SHELVES.map(([t, p, ty], i) => <Lane key={p} title={t} path={p} type={ty} P={P} preload={i === 0 ? first : null} />)}
        </>}
      <p className="attr">Movie and TV information from TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </div>
  </div>{detail}</>;
}
function Lane({ title, path, type, P, preload }: any) {
  const own = useAsync(() => preload ? Promise.resolve(null) : api(path), [path]); const r = preload || own;
  if (r.error) return null;
  return <Shelf title={title}>{r.loading && !r.data ? <SkeletonLane /> : r.data?.results?.filter((m: any) => m.media_type !== 'person').slice(0, 20).map((m: any) => P(m, type))}</Shelf>;
}

function Detail({ sel, back, favs, later }: any) {
  const { s, setArt, setOverlay } = useApp();
  const d = useAsync(() => api(`/tmdb/${sel.type}/${sel.id}`), [sel.id, sel.type]);
  const [trailer, setTrailer] = useState(false), [season, setSeason] = useState(1);
  const [currentProvider, setCurrentProvider] = useState(DEFAULT_PROVIDER_ID);
  const [failedProviders, setFailedProviders] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [episode, setEpisode] = useState(1);
  const [showSourceFinder, setShowSourceFinder] = useState(false);
  const [findingStatus, setFindingStatus] = useState<Record<string, 'pending' | 'success' | 'error'>>({});
  const eps = useAsync(() => sel.type === 'tv' ? api(`/tmdb/tv/${sel.id}/season/${season}`) : Promise.resolve(null), [sel.id, season]);
  const m = d.data; const ref = `${sel.type}:${sel.id}`;
  const vids = m?.videos?.results || []; const tk = vids.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer') || vids.find((v: any) => v.site === 'YouTube');
  useEffect(() => { if (tk) loadYT().catch(() => {}); }, [!!tk]); // eslint-disable-line
  useEffect(() => { if (m?.backdrop_path) setArt({ img: img(m.backdrop_path, 'w1280') }); }, [m]); // eslint-disable-line
  useEffect(() => { setEpisode(1); }, [season]);
  useEffect(() => { setOverlay(trailer || playing); }, [trailer, playing]); // eslint-disable-line
  useBack(back, !trailer && !playing);
  useAutoFocus(`${!!m}-${trailer}-${playing}`); useRestoreFocus(trailer);

  // Listen for iframe error messages and cycle to the next provider
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!playing) return;
      const msg = typeof e.data === 'string' ? e.data : (e.data?.error ?? e.data?.message ?? '');
      if (typeof msg === 'string' && /error|not found|unavailable|playable/i.test(msg)) {
        setFindingStatus((s) => ({ ...s, [currentProvider]: 'error' }));
        const next = getNextEnabledProviderId(currentProvider, [...failedProviders, currentProvider]);
        if (next) {
          setFailedProviders((prev) => [...prev, currentProvider]);
          setCurrentProvider(next);
          setFindingStatus((s) => ({ ...s, [next]: 'pending' }));
        } else {
          setPlaying(false);
        }
      } else {
        setFindingStatus((s) => ({ ...s, [currentProvider]: 'success' }));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [playing, currentProvider, failedProviders]);

  const startPlay = () => {
    setFailedProviders([]);
    setCurrentProvider(DEFAULT_PROVIDER_ID);
    setFindingStatus({ [DEFAULT_PROVIDER_ID]: 'pending' });
    setShowSourceFinder(true);
    setPlaying(true);
  };

  const on = (list: any) => list.data?.some((x: any) => x.ref === ref);
  const toggle = (k: string, list: any) => (on(list) ? del(`/lists?kind=${k}&ref=${encodeURIComponent(ref)}`) : post(`/lists?kind=${k}`, { ref, data: { id: sel.id, type: sel.type, title: m.title || m.name, poster: m.poster_path, backdrop: m.backdrop_path, overview: m.overview } })).then(list.retry);
  const trailerView = trailer && tk && <Player source={{ kind: 'youtube', id: tk.key }} thumb={`https://i.ytimg.com/vi/${tk.key}/hqdefault.jpg`} title={m.title || m.name} subtitle={tk.name || 'Trailer'} volume={s.volume} resume={false} saveProgress={false} onClose={() => setTrailer(false)} />;
  const playView = playing && <Player source={{ kind: 'remote', url: getEmbedUrl(currentProvider, sel.type, sel.id, season, episode) }} title={m?.title || m?.name || 'Streaming media'} subtitle={`Provider: ${providers.find((p: any) => p.id === currentProvider)?.name ?? currentProvider}`} volume={s.volume} resume={false} saveProgress={false} onClose={() => { setPlaying(false); setShowSourceFinder(false); }} />;

  // Visual source-finder modal
  const sourceFinder = showSourceFinder && (
    <div className="layer" data-modal style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, minWidth: 360, maxWidth: 480 }}>
        <h3 style={{ marginTop: 0 }}>Finding a source…</h3>
        <p className="sub" style={{ marginBottom: 16 }}>Trying providers until one works.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {providers.filter((p) => p.enabled).map((p) => {
            const status = findingStatus[p.id];
            return (
              <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ width: 20, textAlign: 'center' }}>
                  {status === 'success' ? '✅' : status === 'error' ? '❌' : status === 'pending' ? '⏳' : '•'}
                </span>
                <span style={{ flex: 1 }}>{p.name}</span>
                {status === 'pending' && <span className="spinner" style={{ width: 14, height: 14, border: '2px solid var(--dust)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
              </li>
            );
          })}
        </ul>
        {Object.values(findingStatus).every((s) => s === 'error') && (
          <p className="note" style={{ marginTop: 12 }}>All providers failed. Try again later.</p>
        )}
      </div>
    </div>
  );

  return <div className="layer" data-modal data-scroll><div className="detail" {...((trailer || playing) ? { inert: '' } : {}) as any}>
    <ErrorNotice e={d.error} retry={d.retry} />
    <div className="detail-top"><Btn ghost icon={Icon.back} onClick={back}>Back</Btn></div>
    {!m ? <div className="center">Loading…</div> : <>
      <h1>{m.title || m.name}</h1>
      <div className="facts">{year(m) && <span className="fact">{year(m)}</span>}{m.vote_average > 0 && <span className="fact star">★ {m.vote_average.toFixed(1)}</span>}
        {m.runtime ? <span className="fact">{Math.floor(m.runtime / 60) ? `${Math.floor(m.runtime / 60)}h ` : ''}{m.runtime % 60}m</span> : m.number_of_seasons ? <span className="fact">{m.number_of_seasons} season{m.number_of_seasons > 1 ? 's' : ''}</span> : null}
        {m.genres?.slice(0, 3).map((g: any) => <span key={g.id} className="fact">{g.name}</span>)}</div>
      <p className="overview">{m.overview || 'No description yet.'}</p>
      <div className="actions">
        {tk && <Btn primary autoFocus icon={Icon.play} onClick={() => setTrailer(true)}>Watch trailer</Btn>}
        <Btn primary autoFocus={!tk} icon={Icon.play} onClick={startPlay}>Play</Btn>
        <Btn autoFocus={!tk} icon={on(favs) ? Icon.heartFill : Icon.heart} onClick={() => toggle('favorite', favs)}>{on(favs) ? 'In favorites' : 'Add to favorites'}</Btn>
        <Btn icon={on(later) ? Icon.check : Icon.plus} onClick={() => toggle('watchlater', later)}>{on(later) ? 'On watch later' : 'Watch later'}</Btn>
      </div>
      {sel.type === 'tv' && m.seasons?.length > 0 && <section className="shelf"><h3>Episodes</h3>
        <div className="seasons">{m.seasons.filter((s: any) => s.season_number > 0).map((s: any) => <button key={s.id} data-nav className={'choice' + (s.season_number === season ? ' on' : '')} onClick={() => setSeason(s.season_number)}>Season {s.season_number}</button>)}</div>
        <ErrorNotice e={eps.error} retry={eps.retry} />
        <div className="episodes">{eps.data?.episodes?.map((e: any) => <div key={e.id} className="episode" data-nav tabIndex={0}><span className="n">{e.episode_number}</span><b>{e.name}{e.runtime ? <small style={{ color: 'var(--dust)', fontWeight: 400 }}>  {e.runtime} min</small> : null}</b><p>{e.overview || 'No description.'}</p></div>)}</div></section>}
      {m.credits?.cast?.length > 0 && <Shelf title="Cast">{m.credits.cast.slice(0, 16).map((c: any) => <div key={c.id} className="person" data-nav tabIndex={0}><div className="face">{c.profile_path && <img loading="lazy" src={img(c.profile_path, 'w185')} alt="" />}</div>{c.name}<small>{c.character}</small></div>)}</Shelf>}
    </>}
  </div>{trailerView}{sourceFinder}{playView}</div>;
}
