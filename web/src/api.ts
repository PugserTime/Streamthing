// All calls go to our own backend; secrets never reach the browser.
let adminToken = sessionStorage.getItem('adminToken') || '';
export const setAdminToken = (t: string) => { adminToken = t; sessionStorage.setItem('adminToken', t); };
// GET requests that fail for network-ish reasons are retried once automatically (the server also retries upstream).
export async function api<T = any>(path: string, init: RequestInit = {}, tries = (init.method || 'GET') === 'GET' ? 2 : 1): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await once<T>(path, init); }
    catch (e: any) {
      const transient = e.transient || e.status === 502 && e.code === 'upstream_failed' || e.status === 504 || e.status === 503 && e.code !== 'not_configured';
      if (!transient || i + 1 >= tries) throw e;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}
async function once<T>(path: string, init: RequestInit): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 35000);
  try {
    const r = await fetch('/api' + path, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken, ...(init.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || j.error || `HTTP ${r.status}`), { code: j.error, help: j.help, status: r.status });
    return j;
  } catch (e: any) {
    if (e.name === 'AbortError') throw Object.assign(new Error('The app took too long to answer.'), { transient: true });
    if (e instanceof TypeError) throw Object.assign(new Error('Lost connection to the Media Center server. Is its window still open?'), { transient: true });
    throw e;
  } finally { clearTimeout(t); }
}
export const put = (p: string, body: any) => api(p, { method: 'PUT', body: JSON.stringify(body) });
export const post = (p: string, body: any = {}) => api(p, { method: 'POST', body: JSON.stringify(body) });
export const del = (p: string, body: any = {}) => api(p, { method: 'DELETE', body: JSON.stringify(body) });
export const img = (path: string | null, size = 'w342') => path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
export const fmt = (s: number) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
