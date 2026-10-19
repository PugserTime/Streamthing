import { getProviders, FullScraperEvents, RunOutput, ScrapeMedia } from "@p-stream/providers";
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
    const allSources = getProviders().listSources();
    const newSources: Record<string, ScrapingSegment> = {};
    evt.sourceIds.forEach(id => {
      const meta = allSources.find(s => s.id === id);
      newSources[id] = {
        id,
        name: meta?.name || id,
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
    const providers = getProviders();
    try {
      const output: RunOutput | null = await providers.runAll({
        media,
        events: { init: initEvent, start: startEvent, update: updateEvent, discoverEmbeds: discoverEmbedsEvent },
      });
      return output;
    } catch (err) {
      console.error("Scrape failed", err);
      return null;
    }
  };

  return { startScraping, sources, currentSource };
}
