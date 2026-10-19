import { getEmbedUrl, providers, DEFAULT_PROVIDER_ID } from '../config/providers';
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
  const [episode, setEpisode] = useState(1);
  const [picker, setPicker] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const eps = useAsync(() => sel.type === 'tv' ? api(`/tmdb/tv/${sel.id}/season/${season}`) : Promise.resolve(null), [sel.id, season]);
  const m = d.data; const ref = `${sel.type}:${sel.id}`;
  const vids = m?.videos?.results || []; const tk = vids.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer') || vids.find((v: any) => v.site === 'YouTube');
  useEffect(() => { if (tk) loadYT().catch(() => {}); }, [!!tk]); // eslint-disable-line
  useEffect(() => { if (m?.backdrop_path) setArt({ img: img(m.backdrop_path, 'w1280') }); }, [m]); // eslint-disable-line
  useEffect(() => { setEpisode(1); }, [season]);
  useEffect(() => { setOverlay(trailer || !!activeProvider); }, [trailer, activeProvider]); // eslint-disable-line
  useBack(back, !trailer && !activeProvider);
  useAutoFocus(`${!!m}-${trailer}-${!!activeProvider}`); useRestoreFocus(trailer);

  const openInBrowser = (id: string) => {
    const url = getEmbedUrl(id, sel.type, sel.id, season, episode);
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const nextProvider = () => {
    if (!activeProvider) return;
    const enabled = providers.filter(p => p.enabled);
    const i = enabled.findIndex(p => p.id === activeProvider);
    setActiveProvider(enabled[(i + 1) % enabled.length].id);
  };

  const on = (list: any) => list.data?.some((x: any) => x.ref === ref);
  const toggle = (k: string, list: any) => (on(list) ? del(`/lists?kind=${k}&ref=${encodeURIComponent(ref)}`) : post(`/lists?kind=${k}`, { ref, data: { id: sel.id, type: sel.type, title: m.title || m.name, poster: m.poster_path, backdrop: m.backdrop_path, overview: m.overview } })).then(list.retry);
  const trailerView = trailer && tk && <Player source={{ kind: 'youtube', id: tk.key }} thumb={`https://i.ytimg.com/vi/${tk.key}/hqdefault.jpg`} title={m.title || m.name} subtitle={tk.name || 'Trailer'} volume={s.volume} resume={false} saveProgress={false} onClose={() => setTrailer(false)} />;
  const providerView = activeProvider && <Player
    source={{ kind: 'iframe', url: getEmbedUrl(activeProvider, sel.type, sel.id, season, episode) }}
    title={m?.title || m?.name || 'Streaming'}
    subtitle={`Provider: ${providers.find(p => p.id === activeProvider)?.name ?? activeProvider}`}
    resume={false}
    saveProgress={false}
    actions={<>
      <Btn icon={Icon.refresh} onClick={nextProvider}>Try next</Btn>
      <Btn icon={Icon.play} onClick={() => openInBrowser(activeProvider)}>Open in browser</Btn>
    </>}
    onClose={() => setActiveProvider(null)}
  />;

  const pickerView = picker && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.88)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', color: 'var(--fg)', padding: 24, borderRadius: 12, maxWidth: 560, width: '100%' }}>
        <h3 style={{ marginTop: 0 }}>Choose a source</h3>
        <p style={{ opacity: 0.7, marginBottom: 16, fontSize: '0.9em', lineHeight: 1.4 }}>
          Providers sometimes block being embedded. If the screen stays blank, use <b>Open in browser</b> in the player's top bar.
        </p>
        {sel.type === 'tv' && <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(m.seasons || []).filter((x: any) => x.season_number > 0).map((x: any) => (
              <button key={x.id} className={'choice' + (x.season_number === season ? ' on' : '')} onClick={() => setSeason(x.season_number)}>Season {x.season_number}</button>
            ))}
          </div>
          <select className="field" value={episode} onChange={e => setEpisode(Number(e.target.value))} style={{ marginBottom: 16, width: '100%' }}>
            {(eps.data?.episodes || []).map((e: any) => <option key={e.id} value={e.episode_number}>Episode {e.episode_number}: {e.name}</option>)}
          </select>
        </>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {providers.filter(p => p.enabled).map(p => (
            <Btn key={p.id} onClick={() => { setPicker(false); setActiveProvider(p.id); }}>
              {p.name}{p.speed ? ` · ${p.speed}` : ''}
            </Btn>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Btn ghost onClick={() => setPicker(false)}>Cancel</Btn>
        </div>
      </div>
    </div>
  );

  return <div className="layer" data-modal data-scroll><div className="detail" {...((trailer || activeProvider) ? { inert: '' } : {}) as any}>
    <ErrorNotice e={d.error} retry={d.retry} />
    <div className="detail-top"><Btn ghost icon={Icon.back} onClick={back}>Back</Btn></div>
    {!m ? <div className="center">Loading…</div> : <>
      <h1>{m.title || m.name}</h1>
      <div className="facts">{year(m) && <span className="fact">{year(m)}</span>}{m.vote_average > 0 && <span className="fact star">★ {m.vote_average.toFixed(1)}</span>}
        {m.runtime ? <span className="fact">{Math.floor(m.runtime / 60) ? `${Math.floor(m.runtime / 60)}h ` : ''}{m.runtime % 60}m</span> : m.number_of_seasons ? <span className="fact">{m.number_of_seasons} season{m.number_of_seasons > 1 ? 's' : ''}</span> : null}
        {m.genres?.slice(0, 3).map((g: any) => <span key={g.id} className="fact">{g.name}</span>)}</div>
      <p className="overview">{m.overview || 'No description yet.'}</p>
      <div className="actions">
        <Btn primary autoFocus icon={Icon.play} onClick={() => setPicker(true)}>Play</Btn>
        {tk && <Btn autoFocus={!tk} icon={Icon.play} onClick={() => setTrailer(true)}>Watch trailer</Btn>}
        <Btn icon={on(favs) ? Icon.heartFill : Icon.heart} onClick={() => toggle('favorite', favs)}>{on(favs) ? 'In favorites' : 'Add to favorites'}</Btn>
        <Btn icon={on(later) ? Icon.check : Icon.plus} onClick={() => toggle('watchlater', later)}>{on(later) ? 'On watch later' : 'Watch later'}</Btn>
      </div>
      {sel.type === 'tv' && m.seasons?.length > 0 && <section className="shelf"><h3>Episodes</h3>
        <div className="seasons">{m.seasons.filter((s: any) => s.season_number > 0).map((s: any) => <button key={s.id} data-nav className={'choice' + (s.season_number === season ? ' on' : '')} onClick={() => setSeason(s.season_number)}>Season {s.season_number}</button>)}</div>
        <ErrorNotice e={eps.error} retry={eps.retry} />
        <div className="episodes">{eps.data?.episodes?.map((e: any) => <div key={e.id} className="episode" data-nav tabIndex={0}><span className="n">{e.episode_number}</span><b>{e.name}{e.runtime ? <small style={{ color: 'var(--dust)', fontWeight: 400 }}>  {e.runtime} min</small> : null}</b><p>{e.overview || 'No description.'}</p></div>)}</div></section>}
      {m.credits?.cast?.length > 0 && <Shelf title="Cast">{m.credits.cast.slice(0, 16).map((c: any) => <div key={c.id} className="person" data-nav tabIndex={0}><div className="face">{c.profile_path && <img loading="lazy" src={img(c.profile_path, 'w185')} alt="" />}</div>{c.name}<small>{c.character}</small></div>)}</Shelf>}
    </>}
  </div>{trailerView}{pickerView}{providerView}</div>;
}
