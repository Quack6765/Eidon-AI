import { useCallback, useRef, useState } from "react";

import { parseResearchPlan } from "@/lib/research-mode";

export type ResearchPlanDraft = {
  message: string;
  plan: string[];
  status: "loading" | "ready" | "error";
  error: string | null;
};

type PlanLoader = () => Promise<unknown>;

export function useResearchPlanDraft() {
  const [draft, setDraft] = useState<ResearchPlanDraft | null>(null);
  const requestRef = useRef(0);
  const regenerateRef = useRef<PlanLoader | null>(null);

  const run = useCallback(async (message: string, loader: PlanLoader) => {
    const requestId = ++requestRef.current;
    setDraft((current) => ({
      message,
      plan: current?.message === message ? current.plan : [],
      status: "loading",
      error: null
    }));

    try {
      const plan = parseResearchPlan(await loader());
      if (!plan) {
        throw new Error("The research plan could not be generated");
      }
      if (requestRef.current !== requestId) return;
      setDraft({ message, plan, status: "ready", error: null });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setDraft((current) => ({
        message,
        plan: current?.plan.length ? current.plan : [message],
        status: "error",
        error: error instanceof Error ? error.message : "The research plan could not be generated"
      }));
    }
  }, []);

  const open = useCallback(
    (input: { message: string; load: PlanLoader; regenerate: PlanLoader }) => {
      regenerateRef.current = input.regenerate;
      void run(input.message, input.load);
    },
    [run]
  );

  const regenerate = useCallback(() => {
    if (draft && regenerateRef.current) void run(draft.message, regenerateRef.current);
  }, [draft, run]);

  const close = useCallback(() => {
    requestRef.current += 1;
    regenerateRef.current = null;
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

  return { draft, open, regenerate, close, updateStep, addStep, removeStep, moveStep };
}
