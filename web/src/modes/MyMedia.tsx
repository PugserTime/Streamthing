import { useEffect, useState } from 'react';
import { api, post, del, setAdminToken, fmt } from '../api';
import { useApp } from '../App';
import { Btn, ErrorNotice, Icon, Notice, Progress, Shelf, hue, prettyName, useAsync, useAutoFocus, useBack, useRestoreFocus } from '../ui';
import Player from '../Player';

const SORTS = [['name', 'A–Z'], ['new', 'Newest'], ['size', 'Largest']] as const;
const size = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;

export default function MyMedia() {
  const { s, intent, setArt, setOverlay, status } = useApp();
  const lib = useAsync(() => api('/library'), []); const prog = useAsync(() => api<any[]>('/progress'), []);
  const [play, setPlay] = useState<any>(null), [sort, setSort] = useState<string>('name'), [q, setQ] = useState(''), [manage, setManage] = useState(false);
  const files: any[] = (lib.data?.files || []).map((f: any) => ({ ...f, title: prettyName(f.name) }));
  const pm: Record<string, any> = Object.fromEntries((prog.data || []).map(p => [p.ref, p]));
  useEffect(() => { if (intent?.play && lib.data) { const f = files.find(x => x.id === intent.play); if (f) setPlay(f); } }, [lib.data]); // eslint-disable-line
  useEffect(() => { setOverlay(!!play); }, [play]); // eslint-disable-line
  useEffect(() => { if (!lib.data?.scan.running) return; const t = setTimeout(lib.retry, 1500); return () => clearTimeout(t); }, [lib.data]); // eslint-disable-line
  useAutoFocus(`${!!play}-${lib.loading && !lib.data}-${manage}`); useRestoreFocus(!!play || manage);
  const player = play && <Player source={{ kind: 'file', id: play.id }} title={play.title} volume={s.volume} resume={s.resume} onClose={() => { setPlay(null); prog.retry(); }} />;

  const shown = files.filter(f => f.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === 'new' ? b.mtime - a.mtime : b.size - a.size);
  const cont = files.filter(f => { const p = pm[`local:${f.id}`]; return p && p.pos > 5 && p.pos / p.dur < 0.95; });
  const Card = (f: any, first?: boolean) => { const p = pm[`local:${f.id}`]; const h = hue(f.title);
    return <button key={f.id} data-nav data-autofocus={first || undefined} className="file" style={{ ['--h' as any]: h }} onFocus={() => setArt({ color: `hsl(${h} 60% 45%)` })} onClick={() => setPlay(f)}>
      <span className="mono">{f.title.slice(0, 2)}</span><b>{f.title}</b><small>{size(f.size)}{p && p.pos > 5 ? ` · ${fmt(p.dur - p.pos)} left` : ''}</small>{p && p.pos > 5 && <Progress p={p.pos / p.dur} />}</button>; };
  const noDirs = lib.data && !lib.data.dirs.length;
  return <><div {...(play || manage ? { inert: '' } : {}) as any}>
    <div className="pagehead"><h2>My Media</h2>{lib.data && <span>{files.length} video{files.length === 1 ? '' : 's'}</span>}</div>
    <ErrorNotice e={lib.error} retry={lib.retry} />
    {noDirs ? <div className="empty"><h3>Add a folder of videos</h3><p>Point Media Center at a folder on this PC or a USB drive, like D:\Videos. It finds MP4, WebM, MKV, MOV and M4V files inside it.</p>
      <Btn primary autoFocus icon={Icon.folder} onClick={() => setManage(true)}>Add a folder</Btn></div> : <>
      <div className="toolbar">
        <input data-nav className="field" placeholder="Filter by name" value={q} onChange={e => setQ(e.target.value)} />
        {SORTS.map(([k, l]) => <button key={k} data-nav className={'choice' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}>{l}</button>)}
        <Btn ghost icon={Icon.folder} onClick={() => setManage(true)}>Folders</Btn>
      </div>
      {lib.data?.scan.running && <Notice title="Looking for videos…">{lib.data.scan.found} found so far.</Notice>}
      {!q && <Shelf title="Continue watching" show={cont.length > 0}>{cont.map((f, i) => Card(f, i === 0))}</Shelf>}
      {lib.data && !shown.length && !lib.data.scan.running && <div className="empty"><h3>{q ? 'No matches' : 'No videos found yet'}</h3><p>{q ? 'Try a different name.' : 'The folders you added don\'t contain any video files. Add another folder or rescan.'}</p></div>}
      <section className="shelf"><h3>{q ? `Matching “${q}”` : 'All videos'}</h3><div className="grid">{shown.map((f, i) => Card(f, !cont.length && i === 0))}</div></section>
      <p className="attr">Plays MP4 (H.264/AAC) and WebM best. Some MKV files use audio or video formats the player can't decode.</p>
    </>}
  </div>
    {manage && <Folders lib={lib} adminRequired={status?.adminRequired} close={() => setManage(false)} />}{player}
  </>;
}

function Folders({ lib, close, adminRequired }: any) {
  const [dir, setDir] = useState(''), [err, setErr] = useState<any>(null), [busy, setBusy] = useState(false);
  useBack(close);
  const act = async (f: () => Promise<any>) => { setErr(null); setBusy(true); try { await f(); setTimeout(lib.retry, 700); } catch (e) { setErr(e); } setBusy(false); };
  const add = () => dir.trim() && act(() => post('/library/dirs', { path: dir }).then(() => setDir('')));
  return <div className="sheet-back" data-modal onClick={e => e.target === e.currentTarget && close()}><div className="sheet" role="dialog" aria-label="Folders">
    <h2>Folders</h2><p>Type or paste a folder path. In File Explorer, right-click a folder → "Copy as path", then paste it here.</p>
    <div className="keyrow"><input data-nav data-autofocus className="field" placeholder="D:\Videos" value={dir} onChange={e => setDir(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} /><Btn primary disabled={busy || !dir.trim()} icon={Icon.plus} onClick={add}>Add</Btn></div>
    {adminRequired && <input data-nav className="field" type="password" placeholder="Admin token (shown in the console window)" onChange={e => setAdminToken(e.target.value)} />}
    <ErrorNotice e={err} />
    <div className="folders">{lib.data?.dirs.map((d: string) => <div key={d} className="folder"><code title={d}>{d}</code><Btn ghost icon={Icon.trash} onClick={() => act(() => del('/library/dirs', { path: d }))}>Remove</Btn></div>)}
      {lib.data?.dirs.length === 0 && <p>No folders yet.</p>}</div>
    {lib.data?.scan.errors?.length > 0 && <p style={{ color: 'var(--danger)' }}>{lib.data.scan.errors.length} item(s) couldn't be read (unplugged drive or no permission).</p>}
    <div className="keyrow" style={{ justifyContent: 'flex-end' }}><Btn ghost icon={Icon.refresh} onClick={() => act(() => post('/library/scan'))}>Rescan</Btn><Btn primary onClick={close}>Done</Btn></div>
  </div></div>;
}
