import { useCallback, useEffect, useRef, useState } from "react";

export interface PlayableStream { url: string; type: "hls" | "mp4" }
export interface ScrapingSegment {
  name: string;
  id: string;
  embedId?: string;
  status: "failure" | "pending" | "notfound" | "success" | "waiting";
  reason?: string;
  percentage: number;
}
export interface ScrapeMedia {
  type: "movie" | "show";
  tmdbId: string;
  title: string;
  releaseYear: number;
  season?: { number: number; tmdbId?: string; title?: string };
  episode?: { number: number; tmdbId?: string };
}

const statuses = new Set(["failure", "pending", "notfound", "success", "waiting"]);
const segment = (id: string): ScrapingSegment => ({ id, name: id, status: "waiting", percentage: 0 });

export function useScraper() {
  const [sources, setSources] = useState<Record<string, ScrapingSegment>>({});
  const [currentSource, setCurrentSource] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const cancelScraping = useCallback(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
    setCurrentSource(undefined);
    setSources(old => Object.fromEntries(Object.entries(old).map(([id, value]) => [id,
      value.status === "pending" ? { ...value, status: "failure" as const, reason: "Search cancelled." } : value,
    ])));
  }, []);

  useEffect(() => () => {
    generation.current++;
    active.current?.abort();
  }, []);

  const startScraping = useCallback(async (media: ScrapeMedia): Promise<PlayableStream | null> => {
    active.current?.abort();
    const run = ++generation.current;
    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => run === generation.current;
    const timeout = setTimeout(() => controller.abort(), 110000);
    setSources({});
    setCurrentSource(undefined);
    setError(null);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed = false;
    let play: PlayableStream | null = null;
    let finalError: string | null = null;
    const handle = (line: string) => {
      if (!line.trim() || !isCurrent() || completed) return;
      const msg = JSON.parse(line);
      if (!msg || typeof msg !== "object") throw new Error("Invalid scraper event.");
      if (msg.done === true) {
        completed = true;
        if (typeof msg.error === "string") finalError = msg.error;
        if (msg.play != null) {
          const p = msg.play;
          if (typeof p.url !== "string" || !/^\/api\/stream\/[a-f0-9]+(?:\.m3u8)?$/.test(p.url) || !["hls", "mp4"].includes(p.type)) {
            throw new Error("The server returned an invalid playback URL.");
          }
          play = { url: p.url, type: p.type };
        }
        return;
      }
      const d = msg.d;
      if (msg.ev === "init") {
        if (!Array.isArray(d?.sourceIds)) throw new Error("Invalid scraper initialization.");
        setSources(Object.fromEntries(d.sourceIds.filter((id: unknown) => typeof id === "string").map((id: string) => [id, segment(id)])));
      } else if (msg.ev === "start" && typeof d === "string") {
        // Starting the next provider is not evidence that the previous provider succeeded.
        setSources(old => ({ ...old, [d]: { ...(old[d] || segment(d)), status: "pending" } }));
        setCurrentSource(d);
      } else if (msg.ev === "update" && typeof d?.id === "string") {
        setSources(old => {
          const previous = old[d.id] || segment(d.id);
          const nextStatus = statuses.has(d.status) ? d.status as ScrapingSegment["status"] : previous.status;
          return { ...old, [d.id]: { ...previous, status: nextStatus,
            reason: typeof d.reason === "string" ? d.reason : previous.reason,
            percentage: typeof d.percentage === "number" && Number.isFinite(d.percentage) ? Math.max(0, Math.min(100, d.percentage)) : previous.percentage,
          } };
        });
      } else if (msg.ev === "discoverEmbeds" && Array.isArray(d?.embeds)) {
        setSources(old => {
          const next = { ...old };
          for (const embed of d.embeds) {
            if (typeof embed?.id !== "string") continue;
            next[embed.id] = { ...(next[embed.id] || segment(embed.id)),
              name: `Embed ${String(embed.embedScraperId || embed.id)}`,
              embedId: typeof embed.embedScraperId === "string" ? embed.embedScraperId : undefined,
            };
          }
          return next;
        });
      }
    };
    try {
      const response = await fetch("/api/scrape", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.message === "string" ? body.message : `Scraper returned HTTP ${response.status}.`);
      }
      if (!response.body) throw new Error("The server did not return a scraper response.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!completed) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.length > 1048576) throw new Error("Scraper event exceeded the size limit.");
          handle(line);
        }
        if (buffer.length > 1048576) throw new Error("Scraper event exceeded the size limit.");
        if (done) {
          if (buffer.trim()) handle(buffer);
          break;
        }
      }
      if (!isCurrent()) return null;
      if (!completed) throw new Error("The source search ended before a final result arrived.");
      setError(finalError || (!play ? "No direct stream found." : null));
      return play;
    } catch (err) {
      if (isCurrent()) {
        finalError = controller.signal.aborted ? "The source search was cancelled or timed out." : err instanceof Error ? err.message : "The source search failed.";
        setError(finalError);
        console.warn("Scrape failed:", finalError);
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (reader) { void reader.cancel().catch(() => {}); }
      controller.abort();
      if (isCurrent()) {
        active.current = null;
        setCurrentSource(undefined);
        setSources(old => Object.fromEntries(Object.entries(old).map(([id, value]) => [id,
          value.status === "pending" ? { ...value, status: "failure" as const, reason: finalError || "No confirmed stream from this provider." } : value,
        ])));
      }
    }
  }, []);

  return { startScraping, cancelScraping, sources, currentSource, error };
}
