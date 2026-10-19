import { useEffect, useState } from 'react';
import { api, post, put } from '../api';
import { useApp } from '../App';
import { Btn, Icon, Notice, pct, useAsync, useAutoFocus } from '../ui';

const SECTIONS = [['keys', 'Accounts & keys'], ['look', 'Look & feel'], ['playback', 'Playback'], ['system', 'System']] as const;
type Sec = typeof SECTIONS[number][0];
const gb = (n: number) => (n / 1073741824).toFixed(1) + ' GB', mb = (n: number) => (n / 1048576).toFixed(0) + ' MB';

export default function Settings() {
  const { intent, status } = useApp();
  const [sec, setSec] = useState<Sec>(intent?.section || (status && (!status.tmdb || !status.youtube) ? 'keys' : 'look'));
  useAutoFocus(sec);
  useEffect(() => { document.querySelector('.view')?.scrollTo({ top: 0 }); }, [sec]);
  return <div className="settings">
    <nav className="snav" data-navgroup>{SECTIONS.map(([k, l]) => <button key={k} data-nav data-active={k === sec || undefined} data-autofocus={k === sec || undefined} className={'tab' + (k === sec ? ' on' : '')} onClick={() => setSec(k)} onFocus={() => setSec(k)}>{l}</button>)}</nav>
    <div className="spane" data-navregion>{sec === 'keys' ? <Keys /> : sec === 'look' ? <Look /> : sec === 'playback' ? <Playback /> : <System />}</div>
  </div>;
}

type Test = { state: 'idle' | 'busy' | 'ok' | 'bad'; msg?: string };
function KeyCard({ name, field, hint, has, test, steps, link }: { name: string; field: 'tmdb' | 'youtube'; hint?: string; has: boolean; test: () => Promise<string>; steps: string[]; link: string }) {
  const { refreshStatus } = useApp();
  const [val, setVal] = useState(''), [r, setR] = useState<Test>({ state: 'idle' });
  const run = async (saveFirst: boolean) => {
    setR({ state: 'busy', msg: saveFirst ? 'Saving and checking…' : 'Checking…' });
    try { if (saveFirst) { await put('/keys', { [field]: val }); setVal(''); refreshStatus(); } setR({ state: 'ok', msg: await test() }); }
    catch (e: any) { setR({ state: 'bad', msg: e.message }); }
  };
  const pill = r.state === 'ok' ? <span className="pill ok">Working</span> : r.state === 'bad' ? <span className="pill bad">Not working</span> : has ? <span className="pill ok">Key saved</span> : <span className="pill">Not set up</span>;
  return <div className="card">
    <header><h3>{name}</h3>{pill}</header>
    {has && hint && <p>Current key: <span className="path">{hint}</span></p>}
    <div className="keyrow">
      <input data-nav className="field" placeholder={has ? 'Paste a new key to replace it' : 'Paste your key here'} value={val} spellCheck={false} autoComplete="off" onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && val.trim() && run(true)} />
      <Btn primary disabled={!val.trim() || r.state === 'busy'} onClick={() => run(true)}>Save key</Btn>
      {has && <Btn ghost disabled={r.state === 'busy'} onClick={() => run(false)}>Test</Btn>}
    </div>
    {r.msg && <p className={'result ' + r.state}>{r.msg}</p>}
    <details><summary data-nav style={{ cursor: 'pointer', color: 'var(--paper)', borderRadius: '.4rem', padding: '.2rem .1rem' }}>How to get a {name} key</summary>
      <ol style={{ marginTop: '.8rem' }}>{steps.map(s => <li key={s}>{s}</li>)}</ol><p style={{ marginTop: '.6rem' }}><a href={link} target="_blank" rel="noreferrer">{link}</a></p></details>
  </div>;
}
function Keys() {
  const { status } = useApp();
  return <>
    <h2>Accounts & keys</h2>
    <p>Paste a key and press Save key — it's checked straight away and works without restarting. Keys stay on this PC and are never sent to the browser.</p>
    {status?.inTemp && <Notice bad title="Unzip the app first">It looks like Media Center is running from inside the zip or a temporary folder, so your keys and library may disappear. Extract the zip to a normal folder (for example C:\MediaCenter) and run it from there.</Notice>}
    <KeyCard name="TMDB" field="tmdb" has={!!status?.tmdb} hint={status?.keyHints?.tmdb} link="https://www.themoviedb.org/settings/api"
      steps={['Make a free account at themoviedb.org and sign in.', 'Open Settings → API and request an API key (choose "Developer", personal use).', 'Copy either the "API Key" (32 characters) or the long "API Read Access Token" — both work.']}
      test={async () => { const r = await api('/tmdb/genre/movie/list'); return `Connected to TMDB — ${r.genres?.length ?? 0} genres loaded.`; }} />
    <KeyCard name="YouTube" field="youtube" has={!!status?.youtube} hint={status?.keyHints?.youtube} link="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
      steps={['Open Google Cloud Console and create a project (free).', 'Enable "YouTube Data API v3" for that project.', 'Go to APIs & Services → Credentials → Create credentials → API key, and copy it (starts with "AIza").', 'If you add restrictions, restrict it to the YouTube Data API only — not to websites/referrers, or it will be rejected.']}
      test={async () => { const r = await api('/youtube/popular?max=1'); return `Connected to YouTube — "${r.items?.[0]?.snippet?.title ?? 'ok'}" is trending.`; }} />
    {status?.envFile && <p style={{ color: 'var(--dust)' }}>Keys are stored in <span className="path">{status.envFile}</span>. You can also edit that file in Notepad; changes are picked up automatically.</p>}
  </>;
}

const Row = ({ label, help, children }: any) => <div className="setting"><div><b>{label}</b>{help && <small>{help}</small>}</div>{children}</div>;
function Choices<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return <div className="choices">{options.map(([k, l]) => <button key={k} data-nav className={'choice' + (value === k ? ' on' : '')} onClick={() => onPick(k)}>{l}</button>)}</div>;
}
const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => <button data-nav role="switch" aria-checked={on} aria-label={label} className={'toggle' + (on ? ' on' : '')} onClick={() => set(!on)} />;

function Look() {
  const { s, save } = useApp();
  return <><h2>Look & feel</h2><div className="card">
    <Row label="Text size" help="Make everything bigger if you sit far from the TV."><Choices value={s.textSize} options={[['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra large']]} onPick={v => save({ textSize: v })} /></Row>
    <Row label="Theme"><Choices value={s.theme} options={[['dark', 'Dark'], ['light', 'Light']]} onPick={v => save({ theme: v })} /></Row>
    <Row label="Accent color" help="Used for buttons and switches."><div className="choices">{['#8f78ff', '#ff5247', '#31c6b4', '#4fa3ff', '#ff9a3c'].map(c => <button key={c} data-nav className={'swatch' + (s.accent === c ? ' on' : '')} style={{ background: c }} onClick={() => save({ accent: c })} aria-label={`Accent ${c}`} />)}</div></Row>
    <Row label="When the app opens"><Choices value={s.startMode} options={[['launcher', 'Show Home'], ['last', 'Reopen last app']]} onPick={v => save({ startMode: v })} /></Row>
    <Row label="Open full screen" help="Starts the window full screen next time the app launches."><Toggle label="Open full screen" on={s.fullscreenOnLaunch} set={v => save({ fullscreenOnLaunch: v })} /></Row>
  </div></>;
}
function Playback() {
  const { s, save } = useApp();
  return <><h2>Playback</h2><div className="card">
    <Row label={`Starting volume — ${Math.round(s.volume * 100)}%`}><input data-nav className="range" type="range" min={0} max={1} step={0.05} value={s.volume} style={pct(s.volume)} onChange={e => save({ volume: +e.target.value })} /></Row>
    <Row label="Resume where I left off" help="Picks up local videos from the last position."><Toggle label="Resume" on={s.resume} set={v => save({ resume: v })} /></Row>
  </div><p style={{ color: 'var(--dust)' }}>Remote and keyboard: arrows move, Enter selects, Esc or Backspace goes back. In the player: Space plays/pauses, ←/→ skip, F full screen.</p></>;
}
function System() {
  const { status, s, save } = useApp();
  const sys = useAsync(() => api('/system'), []); const logs = useAsync(() => api('/logs'), []);
  const [msg, setMsg] = useState('');
  const x = sys.data;
  return <><h2>System</h2>
    <div className="card">{x ? <div className="facts-table">
      <span>Version</span><span>{x.version} (database v{x.dbVersion})</span><span>Running on</span><span>{x.platform}, Node {x.node}</span>
      <span>Memory</span><span>{gb(x.totalMem - x.freeMem)} of {gb(x.totalMem)} used · app uses {mb(x.rss)}</span>
      <span>Free disk</span><span>{x.dataDirFree != null ? gb(x.dataDirFree) : 'unknown'}</span><span>Library database</span><span>{mb(x.dbSize)}</span>
      <span>Data folder</span><span className="path">{status?.dataDir}</span><span>Running for</span><span>{Math.round(x.uptime / 60)} min</span></div> : 'Loading…'}</div>
    <div className="card"><Row label="Show debug info on screen" help="Live RAM, CPU, frame rate and network stats in the corner. F2 toggles it anywhere."><Toggle label="Debug overlay" on={s.debugOverlay} set={v => save({ debugOverlay: v })} /></Row></div>
    <div className="keyrow" style={{ flexWrap: 'wrap' }}>
      <Btn icon={Icon.refresh} onClick={() => { sys.retry(); logs.retry(); }}>Refresh</Btn>
      <Btn onClick={async () => { try { const r = await post('/backup'); setMsg('Backup saved to ' + r.file); } catch (e: any) { setMsg(e.message); } }}>Back up library</Btn>
      <Btn icon={Icon.power} onClick={async () => { if (!confirm('Quit Media Center?')) return; try { await post('/quit'); document.body.innerHTML = '<div class="center" style="min-height:100vh"><h2>Media Center has stopped.</h2><p>You can close this window.</p></div>'; } catch (e: any) { setMsg(e.message); } }}>Quit Media Center</Btn>
    </div>{msg && <p className="result ok">{msg}</p>}
    <div className="card"><h3>Recent log</h3><pre className="logs" tabIndex={0} data-nav>{logs.data?.lines?.filter(Boolean).slice(-80).join('\n')}</pre></div>
  </>;
}
