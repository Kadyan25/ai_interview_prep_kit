"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OpsError,
  applyOps,
  sectionForOp,
  type KitDocument,
  type KitSection,
  type KitState,
  type Op,
} from "@prep/shared";
import { ApiError, api } from "@/lib/api";

/** The sections the server said are being regenerated, if the error carries them. */
function lockedSectionsOf(error: ApiError): KitSection[] | null {
  const details = error.details as { lockedSections?: unknown } | undefined;
  return Array.isArray(details?.lockedSections) ? (details.lockedSections as KitSection[]) : null;
}

const FLUSH_DELAY_MS = 500;

export type SaveState = "idle" | "saving" | "saved" | "error";

export type KitDraft = {
  kit: KitDocument | undefined;
  /** What the user sees: the server state plus edits not yet acknowledged. */
  state: KitState | null;
  version: number;
  saveState: SaveState;
  saveError: string | null;
  isPending: boolean;
  isError: boolean;
  apply: (ops: Op[]) => void;
  refresh: () => Promise<unknown>;
};

function toState(kit: KitDocument): KitState | null {
  if (!kit.body) return null;
  return { body: kit.body, itemState: kit.itemState, counters: kit.counters };
}

/**
 * Editing runs the same reducer the server runs, so the screen updates the
 * instant the user acts and the request that follows is only a confirmation.
 * Operations are queued and flushed together, which turns a burst of typing into
 * one write instead of one per keystroke.
 */
export function useKitDraft(kitId: string): KitDraft {
  const queryClient = useQueryClient();

  const kitQuery = useQuery({
    queryKey: ["kit", kitId],
    queryFn: () => api.getKit(kitId).then((r) => r.kit),
    refetchInterval: (query) => (query.state.data?.status === "generating" ? 2500 : false),
  });

  const [state, setState] = useState<KitState | null>(null);
  // The latest state, readable synchronously: apply() must not queue ops from
  // inside a state updater, which StrictMode runs twice in development.
  const stateRef = useRef<KitState | null>(null);
  const syncState = useCallback((next: KitState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const queue = useRef<Op[]>([]);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The version the queued ops were composed against.
  const baseVersion = useRef(0);

  const kit = kitQuery.data;

  // Adopt server state whenever it is ahead of us and we have nothing in hand.
  useEffect(() => {
    if (!kit) return;
    if (queue.current.length > 0 || inFlight.current) return;
    if (kit.version === version) return;
    syncState(toState(kit));
    setVersion(kit.version);
    baseVersion.current = kit.version;
  }, [kit, version, syncState]);

  const flush = useCallback(async () => {
    if (inFlight.current || queue.current.length === 0) return;

    const sending = queue.current;
    queue.current = [];
    inFlight.current = true;
    setSaveState("saving");

    try {
      const result = await api.patchKit(kitId, baseVersion.current, sending);
      syncState(toState(result.kit));
      setVersion(result.kit.version);
      baseVersion.current = result.kit.version;
      queryClient.setQueryData(["kit", kitId], result.kit);
      setSaveState("saved");
      setSaveError(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        // Someone else wrote first. Take their version, replay our edits on top,
        // and send again. Only the edits themselves are replayed, never a
        // whole-document overwrite.
        const fresh = await api.getKit(kitId).then((r) => r.kit);
        const freshState = toState(fresh);
        if (freshState) {
          try {
            const replayed = applyOps(freshState, sending);
            syncState(replayed);
            setVersion(fresh.version);
            baseVersion.current = fresh.version;
            queue.current = [...sending, ...queue.current];
            inFlight.current = false;
            setSaveState("saving");
            void flush();
            return;
          } catch {
            // The edits no longer make sense against the newer version.
            syncState(freshState);
            setVersion(fresh.version);
            baseVersion.current = fresh.version;
            setSaveState("error");
            setSaveError("This kit changed elsewhere, so those edits were dropped.");
          }
        }
      } else if (error instanceof ApiError && error.code === "SECTION_LOCKED" && lockedSectionsOf(error)) {
        // Only the edits to the section being regenerated are refused. The rest of
        // the batch goes out again rather than being lost along with them.
        const locked = lockedSectionsOf(error)!;
        const allowed = sending.filter((op) => !locked.includes(sectionForOp(op)));
        setSaveState("error");
        setSaveError(error.message);
        const fresh = await api.getKit(kitId).then((r) => r.kit).catch(() => null);
        const freshState = fresh ? toState(fresh) : null;
        if (fresh && freshState) {
          let replayed = freshState;
          try {
            replayed = applyOps(freshState, allowed);
          } catch {
            // Those edits no longer apply to the newer kit; show it as it is.
          }
          syncState(replayed);
          setVersion(fresh.version);
          baseVersion.current = fresh.version;
          queue.current = [...allowed, ...queue.current];
        }
      } else {
        // Anything else: fall back to the server's version rather than leaving
        // the screen showing an edit that was never saved.
        setSaveState("error");
        setSaveError(
          error instanceof ApiError ? error.message : "Could not save. Check your connection.",
        );
        const fresh = await api
          .getKit(kitId)
          .then((r) => r.kit)
          .catch(() => null);
        if (fresh) {
          syncState(toState(fresh));
          setVersion(fresh.version);
          baseVersion.current = fresh.version;
          queryClient.setQueryData(["kit", kitId], fresh);
        }
      }
    } finally {
      inFlight.current = false;
      if (queue.current.length > 0) {
        timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
      }
    }
  }, [kitId, queryClient, syncState]);

  const apply = useCallback(
    (ops: Op[]) => {
      const current = stateRef.current;
      if (!current) return;
      try {
        syncState(applyOps(current, ops));
        queue.current.push(...ops);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
        setSaveState("saving");
        setSaveError(null);
      } catch (error) {
        setSaveState("error");
        setSaveError(error instanceof OpsError ? error.message : "That change could not be applied.");
      }
    },
    [flush, syncState],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["kit", kitId] }),
    [queryClient, kitId],
  );

  // Anything typed but unsent should still go out if the tab is closing.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (queue.current.length > 0) void flush();
    };
  }, [flush]);

  return {
    kit,
    state,
    version,
    saveState,
    saveError,
    isPending: kitQuery.isPending,
    isError: kitQuery.isError,
    apply,
    refresh,
  };
}
