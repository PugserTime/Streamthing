// Compatibility adapter: use the same local scrape endpoint as useScraper.
export interface ScrapedSource {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'unknown';
  name?: string;
}
export interface ScrapeResponse { sources: ScrapedSource[]; subtitles?: unknown[] }

export async function scrapeSources(
  type: 'movie' | 'tv', tmdbId: string | number, title: string,
  releaseYear?: string, season?: number, episode?: number,
): Promise<ScrapedSource[]> {
  const media = {
    type: type === 'tv' ? 'show' : 'movie', tmdbId: String(tmdbId), title,
    releaseYear: Number(releaseYear) || undefined,
    ...(type === 'tv' ? { season: { number: season ?? 1 }, episode: { number: episode ?? 1 } } : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const parse = (line: string): ScrapedSource[] | null => {
    if (!line.trim()) return null;
    const message = JSON.parse(line);
    if (message.done !== true) return null;
    const play = message.play;
    if (!play) return [];
    if (typeof play.url !== 'string' || !/^\/api\/stream\/[a-f0-9]+(?:\.m3u8)?$/.test(play.url) || !['hls', 'mp4'].includes(play.type)) {
      throw new Error('Invalid playback result.');
    }
    return [{ url: play.url, type: play.type, quality: 'unknown', name: typeof message.sourceId === 'string' ? message.sourceId : undefined }];
  };
  try {
    const response = await fetch('/api/scrape', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media }), signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Scraper returned HTTP ${response.status}.`);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 1048576) throw new Error('Scraper event too large.');
        const result = parse(line);
        if (result !== null) return result;
      }
      if (buffer.length > 1048576) throw new Error('Scraper event too large.');
      if (done) {
        const result = parse(buffer);
        if (result !== null) return result;
        throw new Error('Source search ended without a final result.');
      }
    }
  } catch (err) {
    console.warn('Source scraping failed', err);
    return [];
  } finally {
    clearTimeout(timeout);
    if (reader) { void reader.cancel().catch(() => {}); }
    controller.abort();
  }
}
