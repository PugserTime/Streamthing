import type { FullScraperEvents, RunOutput, ScrapeMedia } from "@jenish094/providers";
import { useCallback, useRef, useState } from "react";

export interface ScrapingSegment {
  name: string;
  id: string;
  embedId?: string;
  status: "failure" | "pending" | "notfound" | "success" | "waiting";
  reason?: string;
  percentage: number;
}

type ScraperEvent<Event extends keyof FullScraperEvents> = Parameters<NonNullable<FullScraperEvents[Event]>>[0];

export function useScraper() {
  const [sources, setSources] = useState<Record<string, ScrapingSegment>>({});
  const [currentSource, setCurrentSource] = useState<string>();
  const lastId = useRef<string | null>(null);

  const initEvent = useCallback((evt: ScraperEvent<"init">) => {
    const newSources: Record<string, ScrapingSegment> = {};
    evt.sourceIds.forEach(id => {
      newSources[id] = {
        id,
        name: id,
        status: "waiting",
        percentage: 0,
      };
    });
    setSources(newSources);
  }, []);

  const startEvent = useCallback((id: ScraperEvent<"start">) => {
    setSources(s => {
      const updated = { ...s };
      if (updated[id]) updated[id].status = "pending";
      if (lastId.current && updated[lastId.current] && updated[lastId.current].status === "pending") {
        updated[lastId.current].status = "success";
      }
      return updated;
    });
    setCurrentSource(id);
    lastId.current = id;
  }, []);

  const updateEvent = useCallback((evt: ScraperEvent<"update">) => {
    setSources(s => {
      const updated = { ...s };
      if (updated[evt.id]) {
        updated[evt.id].status = evt.status;
        updated[evt.id].reason = evt.reason;
        updated[evt.id].percentage = evt.percentage;
      }
      return updated;
    });
  }, []);

  const discoverEmbedsEvent = useCallback((evt: ScraperEvent<"discoverEmbeds">) => {
    setSources(s => {
      const updated = { ...s };
      evt.embeds.forEach(v => {
        updated[v.id] = {
          id: v.id,
          name: `Embed ${v.embedScraperId}`,
          embedId: v.embedScraperId,
          status: "waiting",
          percentage: 0,
        };
      });
      return updated;
    });
  }, []);

  const startScraping = async (media: ScrapeMedia) => {
    setSources({});
    lastId.current = null;
    try {
      const r = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media }),
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let output: RunOutput | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.done) output = msg.output ?? null;
          else if (msg.ev === "init") initEvent(msg.d);
          else if (msg.ev === "start") startEvent(msg.d);
          else if (msg.ev === "update") updateEvent(msg.d);
          else if (msg.ev === "discoverEmbeds") discoverEmbedsEvent(msg.d);
        }
      }
      return output;
    } catch (err) {
      console.error("Scrape failed", err);
      return null;
    }
  };

  return { startScraping, sources, currentSource };
}
