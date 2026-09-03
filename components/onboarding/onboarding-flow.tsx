"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  OnboardingStepShell
} from "@/components/onboarding/onboarding-step-shell";
import { DefaultViewStep } from "@/components/onboarding/steps/default-view-step";
import { DoneStep } from "@/components/onboarding/steps/done-step";
import {
  McpServerStep,
  buildMcpServerPayload,
  mcpDraftIsComplete,
  type McpDraft,
  type McpTestResult
} from "@/components/onboarding/steps/mcp-server-step";
import {
  ProviderStep,
  providerDraftIsComplete,
  type ProviderDraft,
  type ProviderTestResult
} from "@/components/onboarding/steps/provider-step";
import { ToolDisplayStep } from "@/components/onboarding/steps/tool-display-step";
import { WelcomeStep } from "@/components/onboarding/steps/welcome-step";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import { buildProviderCatalogPayload, getOnboardingProgress, getOnboardingSteps } from "@/lib/onboarding";
import { PROVIDER_PRESETS } from "@/lib/provider-catalog";
import type { ProviderProfileSummary } from "@/lib/provider-profile";
import type { DefaultView, ToolCallDisplayMode, UserRole } from "@/lib/types";

const VIEW_LABELS: Record<DefaultView, string> = {
  chat: "Chat",
  agents: "Agents",
  automations: "Automations"
};

export type OnboardingSettings = {
  defaultView: DefaultView;
  toolCallDisplay: ToolCallDisplayMode;
  defaultProviderProfileId: string | null;
  providerProfiles: ProviderProfileSummary[];
  skillsEnabled: boolean;
};

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error?.trim() || fallback;
}

export function OnboardingFlow({
  role,
  settings
}: {
  role: UserRole;
  settings: OnboardingSettings;
}) {
  const router = useRouter();
  const toast = useToastState();
  const { showToast } = toast;

  const steps = useMemo(() => getOnboardingSteps(role), [role]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const progress = getOnboardingProgress(steps, step);

  const [defaultView, setDefaultView] = useState<DefaultView>(settings.defaultView);
  const [toolCallDisplay, setToolCallDisplay] = useState<ToolCallDisplayMode>(
    settings.toolCallDisplay
  );

  const [providerDraft, setProviderDraft] = useState<ProviderDraft>({
    choice: null,
    apiKey: "",
    model: "",
    apiBaseUrl: ""
  });
  const [providerTest, setProviderTest] = useState<ProviderTestResult>(null);
  const [providerSaved, setProviderSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [mcpDraft, setMcpDraft] = useState<McpDraft>({
    name: "",
    transport: "streamable_http",
    url: "",
    command: "",
    args: "",
    headers: "",
    env: ""
  });
  const [mcpTest, setMcpTest] = useState<McpTestResult>(null);
  const [mcpSaved, setMcpSaved] = useState(false);

  const [isBusy, setIsBusy] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const goNext = useCallback(() => setStepIndex((index) => index + 1), []);
  const goBack = useCallback(() => setStepIndex((index) => Math.max(0, index - 1)), []);

  const savePreferences = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Unable to save your choice"));
      }
    },
    []
  );

  const commitStep = useCallback(
    async (body: Record<string, unknown>) => {
      setIsBusy(true);
      try {
        await savePreferences(body);
        goNext();
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Unable to save your choice");
      } finally {
        setIsBusy(false);
      }
    },
    [goNext, savePreferences, showToast]
  );

  const saveProvider = useCallback(async () => {
    const targetProfileId =
      settings.defaultProviderProfileId ?? settings.providerProfiles[0]?.id ?? null;
    const choice = providerDraft.choice;
    if (!targetProfileId || !choice) return;

    setIsBusy(true);
    setIsTesting(true);
    setProviderTest(null);
    try {
      const payload = buildProviderCatalogPayload({
        profiles: settings.providerProfiles,
        targetProfileId,
        selection:
          choice.kind === "custom"
            ? {
                kind: "custom",
                providerKind: choice.providerKind,
                apiBaseUrl: providerDraft.apiBaseUrl,
                model: providerDraft.model,
                apiKey: providerDraft.apiKey
              }
            : {
                kind: "preset",
                presetId: choice.presetId,
                model: providerDraft.model,
                apiKey: providerDraft.apiKey
              }
      });

      const saveResponse = await fetch("/api/settings/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillsEnabled: settings.skillsEnabled,
          ...payload
        })
      });
      if (!saveResponse.ok) {
        throw new Error(await readError(saveResponse, "Unable to save the provider"));
      }
      setProviderSaved(true);

      // The test endpoint reads the profile from the database, so it has to run
      // after the save. A failure is reported but never blocks the flow.
      const testResponse = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerProfileId: targetProfileId })
      });
      const testPayload = (await testResponse.json().catch(() => null)) as
        | { success?: boolean; text?: string; error?: string }
        | null;
      if (testResponse.ok && testPayload?.success) {
        setProviderTest({ success: true, message: "Connected. Your provider is ready." });
      } else {
        setProviderTest({
          success: false,
          message:
            testPayload?.error?.trim() ||
            "Saved, but the test call failed. You can continue and fix this in settings."
        });
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to save the provider");
    } finally {
      setIsTesting(false);
      setIsBusy(false);
    }
  }, [providerDraft, settings, showToast]);

  const testMcpDraft = useCallback(async () => {
    setIsTesting(true);
    setMcpTest(null);
    try {
      const response = await fetch("/api/mcp-servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMcpServerPayload(mcpDraft))
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; requiresAuth?: boolean; text?: string; error?: string }
        | null;

      // requiresAuth comes back as HTTP 200 with success:false, so !ok is not
      // enough to detect failure here.
      if (payload?.requiresAuth) {
        setMcpTest({
          state: "auth-required",
          message:
            "This server needs authentication. Save it here, then finish connecting in Settings › MCP servers."
        });
        return;
      }
      if (response.ok && payload?.success) {
        setMcpTest({ state: "success", message: payload.text ?? "Connected." });
        return;
      }
      setMcpTest({
        state: "error",
        message: payload?.error?.trim() || "Could not reach that server."
      });
    } finally {
      setIsTesting(false);
    }
  }, [mcpDraft]);

  const saveMcpServer = useCallback(async () => {
    setIsBusy(true);
    try {
      const response = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMcpServerPayload(mcpDraft))
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Unable to save that MCP server"));
      }
      setMcpSaved(true);
      goNext();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to save that MCP server");
    } finally {
      setIsBusy(false);
    }
  }, [goNext, mcpDraft, showToast]);

  const finish = useCallback(async () => {
    setIsBusy(true);
    try {
      await savePreferences({ defaultView, toolCallDisplay, completed: true });
      router.push("/");
      router.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to finish setup");
      setIsBusy(false);
    }
  }, [defaultView, router, savePreferences, showToast, toolCallDisplay]);

  const summary = useMemo(() => {
    const items = [
      `Opening into ${VIEW_LABELS[defaultView]}`,
      toolCallDisplay === "pills"
        ? "Tool activity shown as pills"
        : "Tool activity shown as a single status line"
    ];
    if (providerSaved) {
      const choice = providerDraft.choice;
      const label =
        choice?.kind === "preset"
          ? PROVIDER_PRESETS.find((item) => item.id === choice.presetId)?.label
          : "Your endpoint";
      items.push(`${label ?? "Your provider"} set as the default provider`);
    }
    if (mcpSaved) {
      items.push(`${mcpDraft.name.trim()} added as an MCP server`);
    }
    return items;
  }, [defaultView, mcpDraft.name, mcpSaved, providerDraft.choice, providerSaved, toolCallDisplay]);

  const toastNode = (
    <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
  );

  if (step === "welcome") {
    return (
      <>
        <WelcomeStep onNext={goNext} />
        {toastNode}
      </>
    );
  }

  if (step === "default-view") {
    return (
      <>
        <OnboardingStepShell
          progress={progress}
          title="Where should Eidon open?"
          subtitle="Pick the view you want when you launch the app. You can change this later in settings."
          onBack={goBack}
          onNext={() => void commitStep({ defaultView })}
          isBusy={isBusy}
        >
          <DefaultViewStep value={defaultView} onChange={setDefaultView} />
        </OnboardingStepShell>
        {toastNode}
      </>
    );
  }

  if (step === "tool-display") {
    return (
      <>
        <OnboardingStepShell
          progress={progress}
          title="How should tool calls look?"
          subtitle="Eidon shows what it is doing while it works. Watch both, then pick the one you prefer."
          onBack={goBack}
          onNext={() => void commitStep({ toolCallDisplay })}
          isBusy={isBusy}
        >
          <ToolDisplayStep value={toolCallDisplay} onChange={setToolCallDisplay} />
        </OnboardingStepShell>
        {toastNode}
      </>
    );
  }

  if (step === "provider") {
    return (
      <>
        <OnboardingStepShell
          progress={progress}
          title="Connect a model provider"
          subtitle="Eidon needs one provider to answer anything. Pick who you already have a key for."
          onBack={goBack}
          onSkip={goNext}
          onNext={() => (providerSaved ? goNext() : void saveProvider())}
          nextLabel={providerSaved ? "Next" : "Save and test"}
          nextDisabled={!providerSaved && !providerDraftIsComplete(providerDraft)}
          isBusy={isBusy}
        >
          <ProviderStep
            draft={providerDraft}
            onChange={(next) => {
              setProviderDraft(next);
              setProviderSaved(false);
              setProviderTest(null);
            }}
            testResult={providerTest}
            isTesting={isTesting}
            showKey={showKey}
            onToggleShowKey={() => setShowKey((current) => !current)}
          />
        </OnboardingStepShell>
        {toastNode}
      </>
    );
  }

  if (step === "mcp-server") {
    return (
      <>
        <OnboardingStepShell
          progress={progress}
          title="Add an MCP server"
          subtitle="MCP servers give Eidon extra tools. Add one now, or skip and add them any time."
          onBack={goBack}
          onSkip={goNext}
          onNext={() => void saveMcpServer()}
          nextLabel="Save and continue"
          nextDisabled={!mcpDraftIsComplete(mcpDraft)}
          isBusy={isBusy}
        >
          <McpServerStep
            draft={mcpDraft}
            onChange={(next) => {
              setMcpDraft(next);
              setMcpTest(null);
            }}
            testResult={mcpTest}
            isTesting={isTesting}
            onTest={() => void testMcpDraft()}
          />
        </OnboardingStepShell>
        {toastNode}
      </>
    );
  }

  return (
    <>
      <OnboardingStepShell
        progress={progress}
        title="You're set up"
        subtitle="Here's what we saved. Everything is editable in settings whenever you want."
        onBack={goBack}
        onNext={() => void finish()}
        nextLabel="Start using Eidon"
        isBusy={isBusy}
      >
        <DoneStep summary={summary} />
      </OnboardingStepShell>
      {toastNode}
    </>
  );
}
