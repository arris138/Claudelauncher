import { useCallback, useEffect, useState } from "react";
import type { Project } from "../types";
import {
  catalogWatermark,
  expiringModels,
  loadCatalog,
  newFreeModelsSince,
  type CatalogModel,
} from "../services/openrouterCatalog";

export interface FreeModelNotice {
  /** Free models added since the user last acknowledged the catalog. */
  fresh: CatalogModel[];
  /**
   * Models a project is currently pinned to that OpenRouter has dated for
   * removal, free or paid. Unlike `fresh` this is not news, it is a pending
   * breakage: on that date the project stops launching.
   */
  expiring: CatalogModel[];
  dismiss: () => void;
}

/**
 * Watches OpenRouter's catalog for free models that showed up since the user
 * last looked, and for dated models a project still points at.
 *
 * The "new" half is a real diff, not a guess: every catalog record carries a
 * `created` unix timestamp, so the watermark is the highest one seen and
 * anything above it is genuinely new. The watermark is seeded on first run
 * rather than starting at zero, otherwise a fresh install would announce all
 * twenty-one free models as new.
 *
 * Runs only when at least one project uses an agent that reads this catalog,
 * so a user who never touches OpenRouter pays no network call for it.
 */
export function useFreeModelWatch(
  projects: Project[],
  watermark: number | undefined,
  setWatermark: (next: number) => void
): FreeModelNotice {
  const [fresh, setFresh] = useState<CatalogModel[]>([]);
  const [expiring, setExpiring] = useState<CatalogModel[]>([]);

  const usesOpenRouter = projects.some((p) => p.agentId === "openrouter");
  const pinned = projects
    .filter((p) => p.agentId === "openrouter" && p.model)
    .map((p) => p.model!)
    .join("\u0000");

  useEffect(() => {
    if (!usesOpenRouter) {
      setFresh([]);
      setExpiring([]);
      return;
    }
    let cancelled = false;

    // Free models are excluded by the reasoning filter about as often as they
    // are included, and this watch is specifically about the free tier, so it
    // asks for the unfiltered-by-reasoning view.
    loadCatalog({ requireReasoning: false })
      .then(({ models, stale }) => {
        if (cancelled || stale) return;

        const high = catalogWatermark(models);
        if (!watermark) {
          // First run: record where the catalog stands and say nothing.
          setWatermark(high);
          return;
        }
        setFresh(newFreeModelsSince(models, watermark));

        const pinnedIds = new Set(pinned.split("\u0000").filter(Boolean));
        setExpiring(
          expiringModels(models).filter((mo) => pinnedIds.has(mo.value))
        );
      })
      .catch(() => {
        // Offline is not an event worth reporting in a status bar.
      });

    return () => {
      cancelled = true;
    };
  }, [usesOpenRouter, pinned, watermark, setWatermark]);

  const dismiss = useCallback(() => {
    // Move the watermark past everything currently announced, so dismissing
    // means "I have seen these" rather than "hide until restart".
    const high = fresh.reduce((max, mo) => (mo.created > max ? mo.created : max), watermark ?? 0);
    setWatermark(high);
    setFresh([]);
  }, [fresh, watermark, setWatermark]);

  return { fresh, expiring, dismiss };
}
