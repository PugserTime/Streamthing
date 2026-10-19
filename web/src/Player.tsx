// web/src/Player.tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export type PlayerSource =
  | { kind: 'youtube'; id: string }
  | { kind: 'remote'; url: string }
  | { kind: 'direct'; url: string };

interface PlayerProps {
  source: PlayerSource;
  thumb?: string;
  title?: string;
  subtitle?: string;
  volume?: number;
  resume?: boolean;
  saveProgress?: boolean;
  onClose: () => void;
}

export let loadYT: () => Promise<void> = () => Promise.resolve();

export default function Player({
  source,
  thumb,
  title,
  subtitle,
  volume = 1,
  resume = true,
  saveProgress = true,
  onClose,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Load YouTube iframe API once (existing behaviour)
  useEffect(() => {
    if (source.kind === 'youtube') {
      // your existing YouTube loader logic here
    }
  }, [source.kind]);

  // For remote (provider) sources, render an iframe, not a <video>
  if (source.kind === 'remote') {
    return (
      <div className="player-layer" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 2, display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>
            <Icon name="close" /> Close
          </button>
        </div>
        <iframe
          src={source.url}
          title={title ?? 'Provider player'}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    );
  }

  // Direct media files (mp4/webm) use the existing <video> element
  if (source.kind === 'direct') {
    return (
      <div className="player-layer" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
        <video
          ref={videoRef}
          src={source.url}
          controls
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%' }}
          onError={() => setError('This URL did not provide a playable video.')}
        />
        {error && (
          <div className="player-error" role="alert">
            <p>{error}</p>
            <button className="btn" onClick={onClose}>Back</button>
          </div>
        )}
      </div>
    );
  }

  // YouTube
  return (
    <div className="player-layer" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
      <div id="yt-player" style={{ width: '100%', height: '100%' }} />
      <button className="btn ghost" style={{ position: 'absolute', top: 12, right: 12 }} onClick={onClose}>
        <Icon name="close" /> Close
      </button>
    </div>
  );
}
