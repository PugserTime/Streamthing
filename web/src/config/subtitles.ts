export interface WingSubtitle {
  id: string;
  language: string;
  url: string;
  type: 'srt' | 'vtt';
  display: string;
  source: string;
}

export interface Cue {
  a: number;
  b: number;
  text: string;
}

export async function fetchWingSubtitles(
  type: 'movie' | 'tv',
  tmdbId: string | number,
  season?: number,
  episode?: number
): Promise<WingSubtitle[]> {
  const params = new URLSearchParams({ type, tmdb: String(tmdbId) });
  if (type === 'tv') {
    params.set('season', String(season || 1));
    params.set('episode', String(episode || 1));
  }

  try {
    const res = await fetch(`https://subs.wing.st/subtitles?${params.toString()}`);
    if (!res.ok) throw new Error(`Wing.st returned ${res.status}`);
    const data = await res.json();
    return data.subtitles || [];
  } catch (err) {
    console.warn('Failed to fetch subtitles from Wing.st', err);
    return [];
  }
}

export async function loadSubtitleCues(sub: WingSubtitle): Promise<Cue[]> {
  const res = await fetch(sub.url);
  if (!res.ok) throw new Error(`Failed to download subtitle: ${res.status}`);
  const text = await res.text();

  if (sub.type === 'vtt' || text.trimStart().startsWith('WEBVTT')) {
    return parseVtt(text);
  }
  return parseSrt(text);
}

function parseSrt(txt: string): Cue[] {
  const ts = (x: string) => {
    const [hms, ms] = x.trim().split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + (Number(ms) || 0) / 1000;
  };

  const out: Cue[] = [];
  for (const block of txt.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;

    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) out.push({ a: ts(a), b: ts(b.split(/\s+/)[0]), text });
  }
  return out.sort((x, y) => x.a - y.a);
}

function parseVtt(txt: string): Cue[] {
  const ts = (x: string) => {
    const p = x.trim().split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const out: Cue[] = [];
  for (const block of txt.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) out.push({ a: ts(a), b: ts(b.trim().split(/\s+/)[0]), text });
  }
  return out.sort((x, y) => x.a - y.a);
}
