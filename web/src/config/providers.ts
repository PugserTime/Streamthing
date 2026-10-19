// web/src/config/providers.ts
export interface Provider {
  id: string;
  name: string;
  speed?: string;
  enabled: boolean;
  movie: (tmdbId: number | string) => string;
  tv: (tmdbId: number | string, season: number, episode: number) => string;
}

export const providers: Provider[] = [
  {
    id: 'vidsrc-to',
    name: 'VidSrc',
    speed: 'Fast',
    enabled: true,
    movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidsrc-me',
    name: 'VidSrc.me',
    enabled: true,
    movie: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
  {
    id: 'embed-su',
    name: 'Embed.su',
    enabled: true,
    movie: (id) => `https://embed.su/embed/movie/${id}`,
    tv: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    enabled: true,
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: '2embed',
    name: '2Embed',
    enabled: true,
    movie: (id) => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
  },
  {
    id: 'multiembed',
    name: 'MultiEmbed',
    enabled: true,
    movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
];

export const DEFAULT_PROVIDER_ID = providers[0].id;

export function getEmbedUrl(
  providerId: string,
  type: 'movie' | 'tv',
  id: number | string,
  season?: number,
  episode?: number
): string {
  const provider = providers.find((p) => p.id === providerId) || providers[0];
  if (type === 'movie') return provider.movie(id);
  return provider.tv(id, season ?? 1, episode ?? 1);
}

export function getNextEnabledProviderId(currentId: string): string {
  const enabled = providers.filter((p) => p.enabled !== false);
  if (!enabled.length) return DEFAULT_PROVIDER_ID;
  const idx = enabled.findIndex((p) => p.id === currentId);
  return enabled[(idx + 1) % enabled.length].id;
}
