"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { getPlatform } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { useAppStore } from "@/stores/app-store";
import {
  type AgentPlanMode,
  type AgentReplyLanguage,
  type AgentReplyStyle,
  useSettingsStore,
} from "@/stores/settings-store";
import { ModelSettings } from "./account-models";
import { ProviderSettings } from "./providers-settings";
import { Row, Section, SettingsSelect, StatusPill } from "./settings-section";

const t = strings.settings.agent;
const permissions = strings.chat.permissions;

export function AgentSettings() {
  const permissionMode = useAppStore((state) => state.permissionMode);
  const autoCompaction = useAppStore((state) => state.autoCompaction);
  const replyStyle = useSettingsStore((state) => state.agentReplyStyle);
  const replyLanguage = useSettingsStore((state) => state.agentReplyLanguage);
  const planMode = useSettingsStore((state) => state.agentPlanMode);
  const patchSettings = useSettingsStore((state) => state.patch);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    getPlatform()
      .then((platform) => platform.speechAvailable())
      .then((available) => {
        if (active) setVoiceAvailable(available);
      })
      .catch(() => {
        if (active) setVoiceAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-7">
      <ProviderSettings />
      <ModelSettings />
      <Section title={t.preferenceTitle}>
        <Row icon="ask" label={t.replyStyle} hint={t.replyStyleHint}>
          <SettingsSelect
            aria-label={t.replyStyle}
            value={replyStyle}
            onChange={(event) =>
              void patchSettings({
                agentReplyStyle: event.currentTarget.value as AgentReplyStyle,
              })
            }
          >
            {t.replyStyles.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SettingsSelect>
        </Row>
        <Row icon="globe" label={t.replyLanguage} hint={t.replyLanguageHint}>
          <SettingsSelect
            aria-label={t.replyLanguage}
            value={replyLanguage}
            onChange={(event) =>
              void patchSettings({
                agentReplyLanguage: event.currentTarget.value as AgentReplyLanguage,
              })
            }
          >
            {t.replyLanguages.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SettingsSelect>
        </Row>
      </Section>
      <Section title={t.executionTitle}>
        <Row icon="shield-check" label={t.execution} hint={permissions[permissionMode].hint}>
          <SettingsSelect
            aria-label={t.execution}
            value={permissionMode}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (mode === "ask" || mode === "edit") {
                void patchSettings({ permissionMode: mode });
              }
            }}
          >
            <option value="ask">{t.confirmFirst}</option>
            <option value="edit">{t.automaticExecution}</option>
            {permissionMode === "full" && (
              <option value="full" disabled>
                {permissions.full.label}
              </option>
            )}
          </SettingsSelect>
        </Row>
        <Row icon="list-check" label={t.plan} hint={t.planHint}>
          <SettingsSelect
            aria-label={t.plan}
            value={planMode}
            onChange={(event) =>
              void patchSettings({
                agentPlanMode: event.currentTarget.value as AgentPlanMode,
              })
            }
          >
            {t.planOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SettingsSelect>
        </Row>
        <Row icon="layers" label={t.context} hint={t.contextHint}>
          <Switch
            ariaLabel={t.autoCompaction}
            checked={autoCompaction ?? true}
            onCheckedChange={(checked) => void patchSettings({ autoCompaction: checked })}
          />
        </Row>
        <Row icon="mic" label={t.voice} hint={t.voiceHint}>
          <StatusPill
            role="status"
            tone={voiceAvailable === null ? "neutral" : voiceAvailable ? "success" : "neutral"}
          >
            {voiceAvailable === null ? t.checking : voiceAvailable ? t.available : t.unavailable}
          </StatusPill>
        </Row>
      </Section>
    </div>
  );
}
