import { getEmbedUrl, providers, DEFAULT_PROVIDER_ID } from '../config/providers';
import { useScraper, PlayableStream } from '../config/scraper';
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
      <p className="attr">Movie and TV information from TMDB.</p>
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

  const { startScraping, sources, currentSource } = useScraper();
  const [scraping, setScraping] = useState(false);
  const [activeStream, setActiveStream] = useState<PlayableStream | null>(null);
  const [embed, setEmbed] = useState(false), [provId, setProvId] = useState(DEFAULT_PROVIDER_ID);

  const eps = useAsync(() => sel.type === 'tv' ? api(`/tmdb/tv/${sel.id}/season/${season}`) : Promise.resolve(null), [sel.id, season]);
  const m = d.data; const ref = `${sel.type}:${sel.id}`;
  const vids = m?.videos?.results || []; const tk = vids.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer') || vids.find((v: any) => v.site === 'YouTube');
  
  useEffect(() => { if (tk) loadYT().catch(() => {}); }, [!!tk]); // eslint-disable-line
  useEffect(() => { if (m?.backdrop_path) setArt({ img: img(m.backdrop_path, 'w1280') }); }, [m]); // eslint-disable-line
  useEffect(() => { setEpisode(1); }, [season]);
  useEffect(() => { setOverlay(trailer || embed || !!activeStream); }, [trailer, embed, activeStream]); // eslint-disable-line
  useBack(() => setEmbed(false), embed);
  useBack(back, !trailer && !embed && !activeStream);
  useAutoFocus(`${!!m}-${trailer}-${embed}-${!!activeStream}`); useRestoreFocus(trailer || embed || !!activeStream);

  // Play: scrape a direct stream file on the server; if no source has one, fall back to the embedded players.
  const handlePlay = async (ep: number = episode) => {
    if (!m || scraping) return;
    setEpisode(ep);
    setScraping(true);
    const media: any = {
      type: sel.type === 'tv' ? 'show' : 'movie',
      tmdbId: String(sel.id),
      title: m.title || m.name,
      releaseYear: Number(year(m)) || undefined,
      ...(sel.type === 'tv' && { season: { number: season, tmdbId: String(season), title: `Season ${season}` }, episode: { number: ep, tmdbId: String(ep) } })
    };
    const play = await startScraping(media);
    setScraping(false);
    if (play) setActiveStream(play); else setEmbed(true);
  };

  const on = (list: any) => list.data?.some((x: any) => x.ref === ref);
  const toggle = (k: string, list: any) => (on(list) ? del(`/lists?kind=${k}&ref=${encodeURIComponent(ref)}`) : post(`/lists?kind=${k}`, { ref, data: { id: sel.id, type: sel.type, title: m.title || m.name, poster: m.poster_path, backdrop: m.backdrop_path, overview: m.overview } })).then(list.retry);

  const trailerView = trailer && tk && <Player source={{ kind: 'youtube', id: tk.key }} thumb={`https://i.ytimg.com/vi/${tk.key}/hqdefault.jpg`} title={m.title || m.name} subtitle={tk.name || 'Trailer'} volume={s.volume} resume={false} saveProgress={false} onClose={() => setTrailer(false)} />;
  
  const playerView = activeStream && (
    <Player
      source={{ kind: 'direct', url: activeStream.url, type: activeStream.type }}
      title={m?.title || m?.name || 'Streaming'}
      subtitle={sel.type === 'tv' ? `S${season} · E${episode}` : 'Direct stream'}
      resume={false}
      saveProgress={false}
      onClose={() => setActiveStream(null)}
    />
  );

  const scraperOverlay = scraping && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--bg)', padding: 32, borderRadius: 16, minWidth: 360, maxWidth: 500, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
        <h2 style={{ marginTop: 0, textAlign: 'center', marginBottom: 24 }}>Finding a Source</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto', paddingRight: 8 }}>
          {Object.values(sources).map((src) => (
            <div key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: src.id === currentSource ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
              <div style={{ width: 24, textAlign: 'center' }}>
                {src.status === 'pending' && <span>…</span>}
                {src.status === 'success' && <span style={{ color: '#4ade80' }}>✔</span>}
                {(src.status === 'failure' || src.status === 'notfound') && <span style={{ color: '#ef4444' }}>✖</span>}
                {src.status === 'waiting' && <span style={{ opacity: 0.3 }}>•</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{src.name}</div>
                {src.reason && <div style={{ fontSize: '0.8em', opacity: 0.6 }}>{src.reason}</div>}
              </div>
            </div>
          ))}
          {Object.keys(sources).length === 0 && <div style={{ textAlign: 'center', opacity: 0.6 }}>Initializing...</div>}
        </div>
      </div>
    </div>
  );

  const embedUrl = embed ? getEmbedUrl(provId, sel.type === 'tv' ? 'tv' : 'movie', sel.id, season, episode) : '';
  const embedView = embed && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center', overflowX: 'auto', background: 'var(--bg)' }}>
        <Btn ghost autoFocus icon={Icon.back} onClick={() => setEmbed(false)}>Close</Btn>
        <span style={{ opacity: 0.7, whiteSpace: 'nowrap', fontSize: '0.85em' }}>No direct stream found. Embedded players:</span>
        {providers.filter(p => p.enabled).map(p => (
          <button key={p.id} data-nav className={'choice' + (p.id === provId ? ' on' : '')} style={{ whiteSpace: 'nowrap' }} onClick={() => setProvId(p.id)}>{p.name}</button>
        ))}
      </div>
      <iframe key={embedUrl} src={embedUrl} title={m?.title || m?.name || 'Player'} style={{ flex: 1, width: '100%', border: 0, background: '#000' }} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
    </div>
  );

  return <div className="layer" data-modal data-scroll><div className="detail" {...((trailer || embed || activeStream) ? { inert: '' } : {}) as any}>
    <ErrorNotice e={d.error} retry={d.retry} />
    <div className="detail-top"><Btn ghost icon={Icon.back} onClick={back}>Back</Btn></div>
    {!m ? <div className="center">Loading…</div> : <>
      <h1>{m.title || m.name}</h1>
      <div className="facts">{year(m) && <span className="fact">{year(m)}</span>}{m.vote_average > 0 && <span className="fact star">★ {m.vote_average.toFixed(1)}</span>}
        {m.runtime ? <span className="fact">{Math.floor(m.runtime / 60) ? `${Math.floor(m.runtime / 60)}h ` : ''}{m.runtime % 60}m</span> : m.number_of_seasons ? <span className="fact">{m.number_of_seasons} season{m.number_of_seasons > 1 ? 's' : ''}</span> : null}
        {m.genres?.slice(0, 3).map((g: any) => <span key={g.id} className="fact">{g.name}</span>)}</div>
      <p className="overview">{m.overview || 'No description yet.'}</p>
      
      <div className="actions">
        <Btn primary autoFocus icon={Icon.play} onClick={() => handlePlay()} disabled={scraping}>{scraping ? 'Searching...' : 'Play'}</Btn>
        {tk && <Btn autoFocus={!tk} icon={Icon.play} onClick={() => setTrailer(true)}>Watch trailer</Btn>}
        <Btn icon={on(favs) ? Icon.heartFill : Icon.heart} onClick={() => toggle('favorite', favs)}>{on(favs) ? 'In favorites' : 'Add to favorites'}</Btn>
        <Btn icon={on(later) ? Icon.check : Icon.plus} onClick={() => toggle('watchlater', later)}>{on(later) ? 'On watch later' : 'Watch later'}</Btn>
      </div>

      {sel.type === 'tv' && m.seasons?.length > 0 && <section className="shelf"><h3>Episodes</h3>
        <div className="seasons">{m.seasons.filter((s: any) => s.season_number > 0).map((s: any) => <button key={s.id} data-nav className={'choice' + (s.season_number === season ? ' on' : '')} onClick={() => setSeason(s.season_number)}>Season {s.season_number}</button>)}</div>
        <ErrorNotice e={eps.error} retry={eps.retry} />
        <div className="episodes">{eps.data?.episodes?.map((e: any) => <div key={e.id} className={'episode' + (e.episode_number === episode ? ' on' : '')} data-nav tabIndex={0} onClick={() => handlePlay(e.episode_number)} onKeyDown={ev => { if (ev.key === 'Enter') handlePlay(e.episode_number); }}><span className="n">{e.episode_number}</span><b>{e.name}{e.runtime ? <small style={{ color: 'var(--dust)', fontWeight: 400 }}>  {e.runtime} min</small> : null}</b><p>{e.overview || 'No description.'}</p></div>)}</div></section>}
      
      {m.credits?.cast?.length > 0 && <Shelf title="Cast">{m.credits.cast.slice(0, 16).map((c: any) => <div key={c.id} className="person" data-nav tabIndex={0}><div className="face">{c.profile_path && <img loading="lazy" src={img(c.profile_path, 'w185')} alt="" />}</div>{c.name}<small>{c.character}</small></div>)}</Shelf>}
    </>}
  </div>{trailerView}{playerView}{embedView}{scraperOverlay}</div>;
}
