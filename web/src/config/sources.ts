// web/src/config/sources.ts

export interface ScrapedSource {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'unknown';
  name?: string;
}

export interface ScrapeResponse {
  sources: ScrapedSource[];
  subtitles?: any[];
}

export async function scrapeSources(
  type: 'movie' | 'tv',
  tmdbId: string | number,
  title: string,
  releaseYear?: string,
  season?: number,
  episode?: number
): Promise<ScrapedSource[]> {
  const params = new URLSearchParams({
    type,
    tmdbId: String(tmdbId),
    title,
    target: 'native',
  });

  if (releaseYear) params.set('releaseYear', releaseYear);
  if (type === 'tv') {
    if (season) params.set('season', String(season));
    if (episode) params.set('episode', String(episode));
  }

  // P-Stream's public providers API
  const apiUrl = `https://api.pstream.mov/scrape?${params.toString()}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`Scraper returned ${res.status}`);
    const data: ScrapeResponse = await res.json();
    
    // Sort sources so HLS is preferred, then by quality (1080p first)
    const sorted = (data.sources || []).sort((a, b) => {
      if (a.type === 'hls' && b.type !== 'hls') return -1;
      if (b.type === 'hls' && a.type !== 'hls') return 1;
      return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
    });

    return sorted;
  } catch (err) {
    console.warn('Source scraping failed', err);
    return [];
  }
}
