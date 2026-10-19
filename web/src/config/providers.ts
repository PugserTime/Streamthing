// web/src/config/providers.ts
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  tag?: string;
  speed?: 'Ultra Fast' | 'Fast' | 'HD' | '4K Ready';
  isDefault?: boolean;
}

export const providers: Provider[] = [
  { id: 'cinemaos', name: 'Aether 1 (Primary)', baseUrl: 'https://cinemaos.tech', enabled: true, tag: 'Default Engine', speed: 'Ultra Fast', isDefault: true },
  { id: 'vidking', name: 'Nebula Stream X', baseUrl: 'https://www.vidking.net', enabled: true, tag: 'Next Episode', speed: '4K Ready' },
  { id: 'vidlink', name: 'Hyperion Link', baseUrl: 'https://vidlink.pro', enabled: true, tag: 'Zero Buffer', speed: 'HD' },
  { id: 'vidsrc_to', name: 'Solaris Cloud', baseUrl: 'https://vidsrc.to/embed', enabled: true, tag: 'VIP Server', speed: 'Ultra Fast' },
  { id: 'vidnest', name: 'Chronos Node', baseUrl: 'https://vidnest.fun', enabled: true, tag: 'Direct Node', speed: 'HD' },
  { id: 'vidfast', name: 'Vortex Quantum', baseUrl: 'https://vidfast.net', enabled: true, tag: 'Fast Buffer', speed: 'Fast' },
  { id: 'videasy', name: 'Elysium Edge', baseUrl: 'https://player.videasy.net', enabled: true, tag: 'Global Edge', speed: 'Fast' },
  { id: 'vidsrc_me', name: 'Pulsar Relay', baseUrl: 'https://vsembed.ru/embed', enabled: true, tag: 'Backup Server', speed: 'HD' },
  { id: 'vidup', name: 'Titan Mesh', baseUrl: 'https://vidup.to', enabled: true, tag: 'Adaptive Mesh', speed: 'Fast' },
  { id: 'rivestream', name: 'Zenith Direct', baseUrl: 'https://rivestream.org/embed', enabled: true, tag: 'High Bitrate', speed: '4K Ready' },
  { id: 'vidcore', name: 'Astral Core 9', baseUrl: 'https://vidcore.org', enabled: true, tag: 'VidCore Core', speed: 'Ultra Fast' },
];

export const DEFAULT_PROVIDER_ID = 'cinemaos';

export const getEmbedUrl = (
  providerId: string = DEFAULT_PROVIDER_ID,
  type: 'movie' | 'tv',
  tmdbId: string | number,
  season: number = 1,
  episode: number = 1
): string => {
  const selected = providers.find((p) => p.id === providerId) || providers[0];
  const cleanId = String(tmdbId);

  // CinemaOS
  if (selected.id === 'cinemaos') {
    return type === 'movie'
      ? `${selected.baseUrl}/player/${cleanId}`
      : `${selected.baseUrl}/player/${cleanId}/${season}/${episode}`;
  }

  // VidKing
  if (selected.id === 'vidking') {
    let url = '';
    if (type === 'movie') {
      url = `${selected.baseUrl}/embed/movie/${cleanId}?color=e50914`;
    } else {
      url = `${selected.baseUrl}/embed/tv/${cleanId}/${season}/${episode}?color=e50914&nextEpisode=true&episodeSelector=true`;
    }
    return url;
  }

  // VidCore
  if (selected.id === 'vidcore') {
    const path = type === 'movie'
      ? `${selected.baseUrl}/embed/movie/${cleanId}`
      : `${selected.baseUrl}/embed/tv/${cleanId}/${season}/${episode}`;
    const params = new URLSearchParams({ theme: 'F59E0B', color: 'F59E0B', autoplay: '1' });
    return `${path}?${params.toString()}`;
  }

  // VidLink Pro
  if (selected.id === 'vidlink') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // vidsrc.to (VIP)
  if (selected.id === 'vidsrc_to') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // VidNest
  if (selected.id === 'vidnest') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // VidFast
  if (selected.id === 'vidfast') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // VidEasy
  if (selected.id === 'videasy') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // vidsrc.me
  if (selected.id === 'vidsrc_me') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // VidUp
  if (selected.id === 'vidup') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // RiveStream
  if (selected.id === 'rivestream') {
    return type === 'movie'
      ? `${selected.baseUrl}/movie/${cleanId}`
      : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
  }

  // Generic fallback
  return type === 'movie'
    ? `${selected.baseUrl}/movie/${cleanId}`
    : `${selected.baseUrl}/tv/${cleanId}/${season}/${episode}`;
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
