import { useEffect, useRef, useState, ReactNode, CSSProperties } from 'react';

// ---------- Back stack: the newest open view (detail, player, sheet) handles Back first ----------
const backStack: { current: () => void }[] = [];
export function useBack(fn: () => void, active = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (!active) return; const entry = { get current() { return ref.current; } } as { current: () => void }; backStack.push(entry); return () => { const i = backStack.indexOf(entry); if (i >= 0) backStack.splice(i, 1); }; }, [active]);
}
let rootBack = () => {};
export const setRootBack = (f: () => void) => { rootBack = f; };
export const goBack = () => (backStack[backStack.length - 1]?.current ?? rootBack)();

const BACK_KEYS = new Set(['Escape', 'BrowserBack', 'GoBack', 'Back']);
// Spatial arrow-key navigation over any visible [data-nav] element (remote / keyboard friendly).
export function useSpatialNav() {
  useEffect(() => {
    // Focus memory: the last item focused in each area (sidebar, video list, settings panel, …) and outside the top bar.
    let lastMain: HTMLElement | null = null;
    const memory = new WeakMap<HTMLElement, HTMLElement>();
    const region = (x: Element) => x.closest<HTMLElement>('[data-navregion],[data-navgroup]');
    const fin = (e: FocusEvent) => { const t = e.target as HTMLElement; if (!t?.matches?.('[data-nav]')) return; if (!t.closest('[data-zone="top"]')) lastMain = t; const r = region(t); if (r) memory.set(r, t); };
    addEventListener('focusin', fin);
    const usable = (x: HTMLElement | null | undefined, els: HTMLElement[]) => !!x && x.isConnected && !!x.offsetParent && els.includes(x);
    const h = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null; const tag = active?.tagName;
      const typing = tag === 'INPUT' && !['range', 'checkbox'].includes((active as HTMLInputElement).type) || tag === 'TEXTAREA';
      if (BACK_KEYS.has(e.key) || (e.key === 'Backspace' && !typing)) { if (e.defaultPrevented) return; if (typing) active!.blur(); goBack(); e.preventDefault(); return; }
      const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
      if (!dir || e.defaultPrevented) return;
      if (typing && dir[1] === 0) { const i = active as HTMLInputElement; const atEdge = dir[0] < 0 ? i.selectionStart === 0 : i.selectionEnd === i.value.length; if (!atEdge) return; }
      if (tag === 'INPUT' && (active as HTMLInputElement).type === 'range' && dir[1] === 0) return;
      if (tag === 'SELECT' && dir[1] !== 0) return;
      const modals = document.querySelectorAll<HTMLElement>('[data-modal]'); const scope: ParentNode = modals[modals.length - 1] || document;
      const els = [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter(x => x.offsetParent && !(x as HTMLButtonElement).disabled && !x.closest('[inert]'));
      if (!active || !els.includes(active)) { (scope.querySelector<HTMLElement>('[data-autofocus]') || els[0])?.focus(); e.preventDefault(); return; }
      const c = active.getBoundingClientRect();
      const zone = (x: Element) => (x.closest('[data-zone]') as HTMLElement | null)?.dataset.zone || 'main';
      // Pick the nearest row (or column) in the direction pressed, then the item in it closest to where we are.
      const pick = (cands: HTMLElement[]) => {
        type C = { el: HTMLElement; along: number; ortho: number; gap: number; align: number };
        const list: C[] = [];
        for (const el of cands) {
          if (el === active) continue;
          const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
          const along = dir[0] ? (dir[0] > 0 ? r.left - c.right : c.left - r.right) : (dir[1] > 0 ? r.top - c.bottom : c.top - r.bottom);
          const centerAhead = dir[0] ? (r.left + r.right - c.left - c.right) * dir[0] > 0 : (r.top + r.bottom - c.top - c.bottom) * dir[1] > 0;
          if (along < -4 || !centerAhead) continue;
          const [lo, hi, clo, chi] = dir[0] ? [r.top, r.bottom, c.top, c.bottom] : [r.left, r.right, c.left, c.right];
          const ortho = Math.max(0, lo - chi, clo - hi);                     // 0 when overlapping on the cross axis
          const mid = (lo + hi) / 2, gap = Math.max(0, clo - mid, mid - chi); // how far its centre is outside our span
          list.push({ el, along: Math.max(0, along), ortho, gap, align: Math.abs(lo - clo) });
        }
        if (!list.length) return null;
        // Prefer things directly in line with us, unless a row/column that isn't in line is clearly closer
        // (e.g. a switch on the right of the row just above).
        const size = dir[0] ? c.width : c.height, tol = Math.max(12, Math.min(48, size * 0.25));
        const overl = list.filter(x => x.ortho === 0);
        const minAll = Math.min(...list.map(x => x.along)), minOver = overl.length ? Math.min(...overl.map(x => x.along)) : Infinity;
        const pool = minOver <= minAll + Math.max(48, size * 0.5) ? overl.filter(x => x.along <= minOver + tol) : list.filter(x => x.along <= minAll + tol);
        return pool.sort((a, b) => a.gap - b.gap || a.along - b.along || a.align - b.align)[0].el;
      };
      // Left/right stay inside the current area (the top bar is only entered with Up).
      const myZone = zone(active);
      const myRegion = region(active), sc = active.closest<HTMLElement>('[data-scroll]');
      let best: HTMLElement | null;
      if (dir[0]) best = pick(els.filter(x => zone(x) === myZone)) || (myZone !== 'main' ? null : pick(els));
      else {
        // Up/Down stay inside the current area (a panel, a sidebar…). At its end, scroll the page fully first, then leave.
        best = pick(myRegion ? els.filter(x => myRegion.contains(x)) : els.filter(x => zone(x) === myZone || dir[1] < 0));
        if (!best) {
          if (sc && dir[1] < 0 && sc.scrollTop > 4) { sc.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); return; }
          if (sc && dir[1] > 0 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) { sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); e.preventDefault(); return; }
          best = myRegion ? pick(els.filter(x => !myRegion.contains(x) && (zone(x) === 'top' || !x.closest('[data-navgroup]')))) : pick(els);
        }
      }
      if (best && dir[0] && zone(best) === 'top' && myZone !== 'top') best = null;
      if (myZone === 'top' && dir[1] > 0 && usable(lastMain, els)) best = lastMain;
      if (best && dir[1] < 0 && myZone !== 'top' && zone(best) === 'top') { const tab = document.querySelector<HTMLElement>('[data-zone="top"] [data-active]'); if (usable(tab, els)) best = tab; }
      // Entering another area: go to its selected item, or where you last were in it, or its starting item.
      if (best) { const from = region(active), to = region(best);
        if (to && to !== from && !(myZone === 'top' && dir[1] > 0)) {
          const act = to.hasAttribute('data-navgroup') ? to.querySelector<HTMLElement>('[data-active]') : null;
          const mem = memory.get(to); const start = to.querySelector<HTMLElement>('[data-autofocus]');
          best = usable(act, els) ? act : usable(mem, els) && to.contains(mem!) ? mem! : usable(start, els) ? start : best;
        } }
      // Leaving a scrolled page upward/downward: first scroll it all the way, so headings and info aren't skipped.
      if (dir[1] && sc && (!best || !sc.contains(best))) {
        if (dir[1] < 0 && sc.scrollTop > 4) { sc.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); return; }
        if (dir[1] > 0 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) { sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); e.preventDefault(); return; }
      }
      if (best) { best.focus({ preventScroll: true }); reveal(best, dir); e.preventDefault(); }
    };
    addEventListener('keydown', h); return () => { removeEventListener('keydown', h); removeEventListener('focusin', fin); };
  }, []);
}
// Keep the focused item comfortably on screen: centre it in its lane horizontally, keep its row in view vertically.
function reveal(el: HTMLElement, dir: number[]) {
  const lane = el.closest('.lane') as HTMLElement | null;
  if (lane) { const lr = lane.getBoundingClientRect(), r = el.getBoundingClientRect(); const target = lane.scrollLeft + (r.left - lr.left) - lr.width * 0.08; if (r.right > lr.right - 40 || r.left < lr.left + 20) lane.scrollTo({ left: Math.max(0, target), behavior: 'smooth' }); }
  if (dir[1] === 0 && lane) return;
  const view = el.closest('[data-scroll]') as HTMLElement | null; if (!view) return;
  const vr = view.getBoundingClientRect(), rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // the focused item grows ~8% and gets a ring, so treat it as a bit bigger than it is right now
  const er = el.getBoundingClientRect(), grow = er.height * 0.05 + rem * 0.7;
  const eTop = er.top - grow, eBot = er.bottom + grow, edge = rem * 1.6;
  // prefer showing the whole row with its title; if that doesn't fit, just the focused item
  const shelf = lane ? (lane.closest('.shelf') as HTMLElement || lane) : null; const sr = shelf?.getBoundingClientRect();
  const fits = sr && sr.height + edge * 2 <= vr.height;
  const top = fits ? Math.min(sr!.top, eTop) : eTop, bot = fits ? Math.max(sr!.bottom, eBot) : eBot;
  let dy = 0;
  if (top < vr.top + edge) dy = top - vr.top - edge;
  else if (bot > vr.bottom - edge) dy = bot - vr.bottom + edge;
  if (Math.abs(dy) > 2) view.scrollBy({ top: dy, behavior: 'smooth' });
}
/** Remember what had focus when `open` turns true, and put focus back there when it turns false (no scroll jump). */
export function useRestoreFocus(open: boolean) {
  const prev = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) { prev.current = document.activeElement as HTMLElement; return; }
    const el = prev.current; prev.current = null;
    if (el && el.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, [open]);
}
/** Focus [data-autofocus] (or the first nav item in the view) whenever `key` changes. */
export function useAutoFocus(key: any, root = '.view') {
  useEffect(() => { const t = setTimeout(() => {
    const modals = document.querySelectorAll<HTMLElement>('[data-modal]'); const r = modals[modals.length - 1] || document.querySelector<HTMLElement>(root); if (!r) return;
    const a = document.activeElement as HTMLElement; if (a && a !== document.body && a.isConnected && r.contains(a)) return;
    const el = r.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') || r.querySelector<HTMLElement>('[data-nav]:not(:disabled)'); if (!el) return;
    el.focus({ preventScroll: true }); const b = el.getBoundingClientRect(); if (b.bottom > innerHeight || b.right > innerWidth || b.top < 0) el.scrollIntoView({ block: 'center', inline: 'center' });
  }, 60); return () => clearTimeout(t); }, [key]); // eslint-disable-line
}
/** Hide the mouse pointer after a few seconds of no movement (TV). */
export function useIdleCursor() {
  useEffect(() => { let t: any; const wake = () => { document.body.classList.remove('cursor-idle'); clearTimeout(t); t = setTimeout(() => document.body.classList.add('cursor-idle'), 3000); }; addEventListener('mousemove', wake); addEventListener('keydown', () => document.body.classList.add('cursor-idle')); wake(); return () => removeEventListener('mousemove', wake); }, []);
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [s, set] = useState<{ data?: T; error?: any; loading: boolean }>({ loading: true }); const [n, setN] = useState(0); const auto = useRef(0);
  useEffect(() => { auto.current = 0; }, deps); // eslint-disable-line
  useEffect(() => { let on = true; set(x => ({ ...x, loading: true, error: undefined }));
    fn().then(data => { if (on) { auto.current = 0; set({ data, loading: false }); } }, error => on && set(x => ({ data: x.data, error, loading: false })));
    return () => { on = false; }; }, [...deps, n]); // eslint-disable-line
  // Network hiccup: quietly try again a few times (5s, 15s, 30s) before leaving the error up.
  useEffect(() => {
    const e = s.error; if (!e || auto.current >= 3) return;
    if (!(e.transient || e.code === 'upstream_failed' || e.status === 504)) return;
    const t = setTimeout(() => { auto.current++; setN(x => x + 1); }, [5000, 15000, 30000][auto.current]); return () => clearTimeout(t);
  }, [s.error]);
  return { ...s, retry: () => { auto.current = 0; setN(x => x + 1); } };
}

type BtnP = { children: ReactNode; onClick?: () => void; primary?: boolean; ghost?: boolean; disabled?: boolean; title?: string; autoFocus?: boolean; icon?: ReactNode; className?: string };
export const Btn = (p: BtnP) =>
  <button data-nav data-autofocus={p.autoFocus || undefined} className={['btn', p.primary && 'primary', p.ghost && 'ghost', p.className].filter(Boolean).join(' ')} disabled={p.disabled} title={p.title} onClick={p.onClick}>{p.icon}{p.children}</button>;

export function Notice({ title, children, action, bad }: { title: string; children?: ReactNode; action?: ReactNode; bad?: boolean }) {
  return <div className={'notice' + (bad ? ' bad' : '')} role={bad ? 'alert' : undefined}><div><b>{title}</b>{children && <p>{children}</p>}</div>{action}</div>;
}
/** Error from api(): key problems get a button to the key screen, everything else a Retry. */
export function ErrorNotice({ e, retry, openKeys }: { e: any; retry?: () => void; openKeys?: () => void }) {
  if (!e) return null;
  const keyIssue = e.code === 'not_configured' || e.code === 'bad_key';
  return <Notice bad title={e.code === 'not_configured' ? 'Key needed' : e.code === 'bad_key' ? 'The key was rejected' : 'Something went wrong'}
    action={keyIssue && openKeys ? <Btn primary onClick={openKeys}>Open Accounts & keys</Btn> : retry ? <Btn onClick={retry}>Try again</Btn> : undefined}>{e.message}</Notice>;
}

export const Shelf = ({ title, children, show = true }: { title: string; children: ReactNode; show?: boolean }) =>
  show ? <section className="shelf"><h3>{title}</h3><div className="lane">{children}</div></section> : null;
export const SkeletonLane = ({ n = 6, w = '11rem', ratio = '2/3' }: { n?: number; w?: string; ratio?: string }) =>
  <>{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ flex: `0 0 ${w}`, aspectRatio: ratio, borderRadius: '.75rem' }} />)}</>;

export const Progress = ({ p }: { p: number }) => <div className="pbar"><i style={{ width: `${Math.min(100, Math.max(0, p * 100))}%` }} /></div>;
export const pct = (v: number, min = 0, max = 1) => ({ ['--p' as any]: `${((v - min) / (max - min || 1)) * 100}%` }) as CSSProperties;

// Simple line icons (stroke = currentColor)
const I = (d: ReactNode, vb = '0 0 24 24') => <svg viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
export const Icon = {
  play: I(<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />),
  pause: I(<><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></>),
  back: I(<path d="M15 5l-7 7 7 7" />),
  search: I(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  heart: I(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />),
  heartFill: I(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" />),
  plus: I(<path d="M12 5v14M5 12h14" />),
  check: I(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  bookmark: I(<path d="M7 4h10v16l-5-3.5L7 20z" />),
  bookmarkFill: I(<path d="M7 4h10v16l-5-3.5L7 20z" fill="currentColor" />),
  folder: I(<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />),
  refresh: I(<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>),
  close: I(<path d="M6 6l12 12M18 6L6 18" />),
  full: I(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
  volume: I(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>),
  mute: I(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>),
  rew: I(<><path d="M11 7l-6 5 6 5z" fill="currentColor" stroke="none" /><path d="M19 7l-6 5 6 5z" fill="currentColor" stroke="none" /></>),
  fwd: I(<><path d="M5 7l6 5-6 5z" fill="currentColor" stroke="none" /><path d="M13 7l6 5-6 5z" fill="currentColor" stroke="none" /></>),
  trash: I(<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />),
  key: I(<><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5L19 4M16 7l2 2M14 9l2 2" /></>),
  power: I(<><path d="M12 4v8" /><path d="M7 6.8a7 7 0 1 0 10 0" /></>),
};
// App glyphs for the home tiles
export const Glyph = {
  youtube: I(<><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" /></>),
  streaming: I(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4" /></>),
  mymedia: I(<><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M10.5 11v5l4-2.5z" fill="currentColor" stroke="none" /></>),
  settings: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2" /><circle cx="12" cy="12" r="7" /></>),
};
export const Logo = () => <svg viewBox="0 0 32 32" aria-hidden><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8f78ff" /><stop offset="1" stopColor="#3f8fe0" /></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)" /><rect x="7" y="8.5" width="18" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="2.2" /><path d="M14 11.5v6l5-3z" fill="#fff" /><rect x="12" y="23" width="8" height="2" rx="1" fill="#fff" /></svg>;

/** Stable hue from a string, for generated artwork. */
export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const prettyName = (n: string) => n.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
