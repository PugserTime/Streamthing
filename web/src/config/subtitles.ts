// web/src/config/subtitles.ts

export interface WingSubtitle {
  id: string;
  language: string;
  url: string;
  type: 'srt' | 'vtt';
  display: string;
  source: string;
}

export interface Cue {
  a: number; // start time in seconds
  b: number; // end time in seconds
  text: string;
}

// Fetch the list of available subtitles for a movie or TV episode
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

  const url = `https://subs.wing.st/subtitles?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wing.st returned ${res.status}`);
    const data = await res.json();
    // The API returns { total: number, subtitles: WingSubtitle[] }
    return data.subtitles || [];
  } catch (err) {
    console.warn('Failed to fetch subtitles from Wing.st', err);
    return [];
  }
}

// Download and parse a subtitle file (supports SRT and VTT)
export async function loadSubtitleCues(sub: WingSubtitle): Promise<Cue[]> {
  const res = await fetch(sub.url);
  if (!res.ok) throw new Error(`Failed to download subtitle: ${res.status}`);
  const text = await res.text();

  if (sub.type === 'vtt' || text.trimStart().startsWith('WEBVTT')) {
    return parseVtt(text);
  }
  return parseSrt(text);
}

// Minimal SRT parser (Wing.st returns .srt files)
function parseSrt(txt: string): Cue[] {
  const ts = (x: string) => {
    // SRT timestamps look like 00:01:23,456
    const [hms, ms] = x.trim().split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + (Number(ms) || 0) / 1000;
  };

  const out: Cue[] = [];
  // SRT blocks are separated by blank lines
  for (const block of txt.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;

    // Find the timestamp line (the one containing " --> ")
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;

    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) {
      out.push({ a: ts(a), b: ts(b.split(/\s+/)[0]), text });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}

// Re-use your existing VTT parser logic (copy it here or import from Player.tsx)
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
    if (text) {
      out.push({ a: ts(a), b: ts(b.trim().split(/\s+/)[0]), text });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}
