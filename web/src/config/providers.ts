// web/src/config/providers.ts
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  tag?: string;
  speed?: 'Ultra Fast' | 'Fast' | 'HD' | '4K Ready';
}

export const providers: Provider[] = [
  { id: 'vidsrc_to', name: 'VidSrc.to', baseUrl: 'https://vidsrc.to/embed', enabled: true, tag: 'VIP', speed: 'Ultra Fast' },
  { id: 'vidlink', name: 'VidLink', baseUrl: 'https://vidlink.pro', enabled: true, tag: 'Zero Buffer', speed: 'HD' },
  { id: 'embed_su', name: 'Embed.su', baseUrl: 'https://embed.su/embed', enabled: true, tag: 'Global', speed: 'Fast' },
  { id: 'vidsrc_me', name: 'VidSrc.me', baseUrl: 'https://vidsrc.me/embed', enabled: true, tag: 'Backup', speed: 'HD' },
  { id: 'multiembed', name: 'MultiEmbed', baseUrl: 'https://multiembed.mov', enabled: true, tag: 'Multi', speed: 'Fast' },
  { id: '2embed', name: '2Embed', baseUrl: 'https://www.2embed.cc', enabled: true, tag: 'Classic', speed: 'HD' },
  { id: 'vidfast', name: 'VidFast', baseUrl: 'https://vidfast.net', enabled: true, tag: 'Fast', speed: 'Fast' },
  { id: 'videasy', name: 'VidEasy', baseUrl: 'https://player.videasy.net', enabled: true, tag: 'Edge', speed: 'Fast' },
  { id: 'vidnest', name: 'VidNest', baseUrl: 'https://vidnest.fun', enabled: true, tag: 'Direct', speed: 'HD' },
  { id: 'vidup', name: 'VidUp', baseUrl: 'https://vidup.to', enabled: true, tag: 'Mesh', speed: 'Fast' },
  { id: 'rivestream', name: 'RiveStream', baseUrl: 'https://rivestream.org/embed', enabled: true, tag: 'High Bitrate', speed: '4K Ready' },
  { id: 'vidcore', name: 'VidCore', baseUrl: 'https://vidcore.org', enabled: true, tag: 'Core', speed: 'Ultra Fast' },
];

export const DEFAULT_PROVIDER_ID = 'vidsrc_to';

export const getEmbedUrl = (
  providerId: string = DEFAULT_PROVIDER_ID,
  type: 'movie' | 'tv',
  tmdbId: string | number,
  season: number = 1,
  episode: number = 1
): string => {
  const p = providers.find((x) => x.id === providerId) ?? providers[0];
  const id = String(tmdbId);

  if (p.id === 'vidsrc_to') {
    return type === 'movie'
      ? `${p.baseUrl}/movie/${id}`
      : `${p.baseUrl}/tv/${id}/${season}/${episode}`;
  }
  if (p.id === 'vidlink') {
    return type === 'movie'
      ? `${p.baseUrl}/movie/${id}`
      : `${p.baseUrl}/tv/${id}/${season}/${episode}`;
  }
  if (p.id === 'embed_su') {
    return type === 'movie'
      ? `${p.baseUrl}/movie/${id}`
      : `${p.baseUrl}/tv/${id}/${season}/${episode}`;
  }
  if (p.id === 'vidsrc_me') {
    return type === 'movie'
      ? `${p.baseUrl}/movie?tmdb=${id}`
      : `${p.baseUrl}/tv?tmdb=${id}&season=${season}&episode=${episode}`;
  }
  if (p.id === 'multiembed') {
    return type === 'movie'
      ? `${p.baseUrl}/?video_id=${id}&tmdb=1`
      : `${p.baseUrl}/?video_id=${id}&tmdb=1&s=${season}&e=${episode}`;
  }
  if (p.id === '2embed') {
    return type === 'movie'
      ? `${p.baseUrl}/embed/${id}`
      : `${p.baseUrl}/embedtv/${id}&s=${season}&e=${episode}`;
  }
  // Generic fallback – most providers follow /movie/ID or /tv/ID/S/E
  return type === 'movie'
    ? `${p.baseUrl}/movie/${id}`
    : `${p.baseUrl}/tv/${id}/${season}/${episode}`;
};

export const getNextEnabledProviderId = (
  currentId: string,
  failedIds: string[] = []
): string | null => {
  const enabled = providers.filter((p) => p.enabled && !failedIds.includes(p.id));
  if (enabled.length === 0) return null;
  const idx = enabled.findIndex((p) => p.id === currentId);
  if (idx === -1 || idx === enabled.length - 1) return enabled[0].id;
  return enabled[idx + 1].id;
};
