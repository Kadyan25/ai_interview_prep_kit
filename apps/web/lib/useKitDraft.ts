"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpsError, applyOps, type KitDocument, type KitState, type Op } from "@prep/shared";
import { ApiError, api } from "@/lib/api";

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
    setState(toState(kit));
    setVersion(kit.version);
    baseVersion.current = kit.version;
  }, [kit, version]);

  const flush = useCallback(async () => {
    if (inFlight.current || queue.current.length === 0) return;

    const sending = queue.current;
    queue.current = [];
    inFlight.current = true;
    setSaveState("saving");

    try {
      const result = await api.patchKit(kitId, baseVersion.current, sending);
      setState(toState(result.kit));
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
            setState(replayed);
            setVersion(fresh.version);
            baseVersion.current = fresh.version;
            queue.current = [...sending, ...queue.current];
            inFlight.current = false;
            setSaveState("saving");
            void flush();
            return;
          } catch {
            // The edits no longer make sense against the newer version.
            setState(freshState);
            setVersion(fresh.version);
            baseVersion.current = fresh.version;
            setSaveState("error");
            setSaveError("This kit changed elsewhere, so those edits were dropped.");
          }
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
          setState(toState(fresh));
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
  }, [kitId, queryClient]);

  const apply = useCallback(
    (ops: Op[]) => {
      setState((current) => {
        if (!current) return current;
        try {
          const next = applyOps(current, ops);
          queue.current.push(...ops);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
          setSaveState("saving");
          setSaveError(null);
          return next;
        } catch (error) {
          setSaveState("error");
          setSaveError(
            error instanceof OpsError ? error.message : "That change could not be applied.",
          );
          return current;
        }
      });
    },
    [flush],
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
    refresh: () => queryClient.invalidateQueries({ queryKey: ["kit", kitId] }),
  };
}
