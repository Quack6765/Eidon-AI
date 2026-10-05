import { useCallback, useRef, useState } from "react";

import { parseResearchPlan } from "@/lib/research-mode";

export type ResearchPlanDraft = {
  message: string;
  plan: string[];
  updates: string[];
  status: "loading" | "updating" | "ready" | "error";
  error: string | null;
};

type PlanLoader = () => Promise<unknown>;
type RefineLoader = (input: { plan: string[]; instruction: string }) => Promise<unknown>;

export function useResearchPlanDraft() {
  const [draft, setDraft] = useState<ResearchPlanDraft | null>(null);
  const requestRef = useRef(0);
  const regenerateRef = useRef<PlanLoader | null>(null);
  const refineRef = useRef<RefineLoader | null>(null);

  const run = useCallback(async (message: string, loader: PlanLoader) => {
    const requestId = ++requestRef.current;
    setDraft((current) => ({
      message,
      plan: current?.message === message ? current.plan : [],
      updates: current?.message === message ? current.updates : [],
      status: "loading",
      error: null
    }));

    try {
      const plan = parseResearchPlan(await loader());
      if (!plan) {
        throw new Error("The research plan could not be generated");
      }
      if (requestRef.current !== requestId) return;
      setDraft({ message, plan, updates: [], status: "ready", error: null });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setDraft((current) => ({
        message,
        plan: current?.plan.length ? current.plan : [message],
        updates: current?.updates ?? [],
        status: "error",
        error: error instanceof Error ? error.message : "The research plan could not be generated"
      }));
    }
  }, []);

  const open = useCallback(
    (input: { message: string; load: PlanLoader; regenerate: PlanLoader; refine: RefineLoader }) => {
      regenerateRef.current = input.regenerate;
      refineRef.current = input.refine;
      void run(input.message, input.load);
    },
    [run]
  );

  const regenerate = useCallback(() => {
    if (draft && regenerateRef.current) void run(draft.message, regenerateRef.current);
  }, [draft, run]);

  const refine = useCallback(
    (instruction: string) => {
      const current = draft;
      if (!current || current.status === "loading" || current.status === "updating" || !refineRef.current) return;
      const loader = refineRef.current;
      const plan = current.plan.map((step) => step.trim()).filter(Boolean);
      if (!plan.length) return;
      const requestId = ++requestRef.current;
      setDraft({ ...current, status: "updating", error: null });

      void (async () => {
        try {
          const revised = parseResearchPlan(await loader({ plan, instruction }));
          if (!revised) {
            throw new Error("The plan could not be updated");
          }
          if (requestRef.current !== requestId) return;
          setDraft((state) =>
            state
              ? { ...state, plan: revised, updates: [...state.updates, instruction], status: "ready", error: null }
              : state
          );
        } catch (error) {
          if (requestRef.current !== requestId) return;
          setDraft((state) =>
            state
              ? {
                  ...state,
                  status: "error",
                  error: error instanceof Error ? error.message : "The plan could not be updated"
                }
              : state
          );
        }
      })();
    },
    [draft]
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    regenerateRef.current = null;
    refineRef.current = null;
    setDraft(null);
  }, []);

  const updatePlan = useCallback((update: (plan: string[]) => string[]) => {
    setDraft((current) => (current ? { ...current, plan: update(current.plan) } : current));
  }, []);

  const updateStep = useCallback(
    (index: number, value: string) => updatePlan((plan) => plan.map((step, i) => (i === index ? value : step))),
    [updatePlan]
  );
  const addStep = useCallback(() => updatePlan((plan) => [...plan, ""]), [updatePlan]);
  const removeStep = useCallback(
    (index: number) => updatePlan((plan) => plan.filter((_, i) => i !== index)),
    [updatePlan]
  );
  const moveStep = useCallback(
    (index: number, delta: -1 | 1) =>
      updatePlan((plan) => {
        const target = index + delta;
        if (target < 0 || target >= plan.length) return plan;
        const next = [...plan];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      }),
    [updatePlan]
  );

  return { draft, open, regenerate, refine, close, updateStep, addStep, removeStep, moveStep };
}
