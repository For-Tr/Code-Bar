import React, { useEffect, useState } from "react";
import { type LocaleSetting, useAppI18n } from "../i18n";
import { useSettingsStore, type ThemeMode, type LayoutMode, type SplitWidgetCanvasItem, isGlassTheme } from "../store/settingsStore";

const C = {
  surface: "var(--ci-surface)",
  border: "var(--ci-border)",
  text: "var(--ci-text)",
  textMuted: "var(--ci-text-muted)",
  textDim: "var(--ci-text-dim)",
  accent: "var(--ci-accent)",
  accentBg: "var(--ci-accent-bg)",
  accentBdr: "var(--ci-accent-bdr)",
  red: "var(--ci-red)",
};

function Toggle({
  value,
  onChange,
  label,
  desc,
  disabled = false,
  showDivider = true,
  labelStyle,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
  disabled?: boolean;
  showDivider?: boolean;
  labelStyle?: React.CSSProperties;
}) {
  return (
    <div
      onClick={() => {
        if (disabled) return;
        onChange(!value);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "9px 0",
        cursor: disabled ? "default" : "pointer",
        borderBottom: showDivider ? `1px solid ${C.border}` : "none",
        opacity: disabled ? 0.56 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.text, ...labelStyle }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{desc}</div>}
      </div>
      <div
        style={{
          width: 36,
          height: 20,
          borderRadius: 99,
          flexShrink: 0,
          background: value ? C.accent : "rgba(120,120,128,0.2)",
          display: "flex",
          alignItems: "center",
          padding: "0 2px",
          transition: "background 0.22s",
          boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25), 0 0.5px 1px rgba(0,0,0,0.12)",
            transform: value ? "translateX(16px)" : "translateX(0)",
            transition: "transform 0.22s",
          }}
        />
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { t } = useAppI18n();
  const { settings, patchSettings } = useSettingsStore();

  type ThemeOption = ThemeMode;
  type LayoutOption = LayoutMode;

  const themeOptions: {
    value: ThemeOption;
    label: string;
    icon: string;
    shell: string;
    card: string;
    accent: string;
    textColor: string;
  }[] = [
    {
      value: "light",
      label: t("settings.themeOptions.light"),
      icon: "☀",
      shell: "linear-gradient(180deg, #f7f9fc 0%, #eef2f8 100%)",
      card: "rgba(255,255,255,0.76)",
      accent: "#0f7cff",
      textColor: "#223246",
    },
    {
      value: "dark",
      label: t("settings.themeOptions.dark"),
      icon: "◐",
      shell: "linear-gradient(180deg, #17191f 0%, #101217 100%)",
      card: "rgba(43,48,60,0.78)",
      accent: "#5ea1ff",
      textColor: "rgba(245,247,255,0.92)",
    },
    {
      value: "glass",
      label: t("settings.themeOptions.glass"),
      icon: "◎",
      shell: "linear-gradient(135deg, rgba(244,248,255,0.72) 0%, rgba(210,228,255,0.38) 100%)",
      card: "rgba(255,255,255,0.34)",
      accent: "#3291ff",
      textColor: "#173556",
    },
    {
      value: "system",
      label: t("settings.themeOptions.system"),
      icon: "⌘",
      shell: "linear-gradient(135deg, #f6f7fb 0%, #d9dde7 48%, #1e2330 100%)",
      card: "rgba(255,255,255,0.62)",
      accent: "#4f7bff",
      textColor: "#243347",
    },
  ];

  const layoutOptions: {
    value: LayoutOption;
    label: string;
    desc: string;
    preview: string;
  }[] = [
    {
      value: "original",
      label: t("settings.layoutOptions.original.label"),
      desc: t("settings.layoutOptions.original.description"),
      preview: t("settings.layoutOptions.original.preview"),
    },
    {
      value: "split",
      label: t("settings.layoutOptions.split.label"),
      desc: t("settings.layoutOptions.split.description"),
      preview: t("settings.layoutOptions.split.preview"),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 10 }}>
          {t("settings.sections.theme")}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {themeOptions.map((opt) => {
            const active = settings.theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => patchSettings({ theme: opt.value })}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 12,
                  background: active ? "linear-gradient(180deg, var(--ci-surface-hi), var(--ci-surface))" : C.surface,
                  border: `1px solid ${active ? C.accentBdr : C.border}`,
                  borderRadius: 18,
                  cursor: "pointer",
                  textAlign: "start",
                  transition: "transform 0.16s, border-color 0.16s, box-shadow 0.16s, background 0.16s",
                  boxShadow: active ? `0 0 0 3px ${C.accentBg}, var(--ci-card-shadow-strong)` : "none",
                  transform: active ? "translateY(-1px)" : "translateY(0)",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    height: 118,
                    borderRadius: 14,
                    background: opt.shell,
                    overflow: "hidden",
                    padding: 12,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "linear-gradient(180deg, rgba(255,255,255,0.18), transparent 48%)",
                      opacity: 0.55,
                      pointerEvents: "none",
                    }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 8, height: "100%" }}>
                    <div
                      style={{
                        borderRadius: 12,
                        background: opt.card,
                        boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
                        backdropFilter: "blur(18px)",
                        WebkitBackdropFilter: "blur(18px)",
                      }}
                    />
                    <div style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          borderRadius: 12,
                          background: opt.card,
                          backdropFilter: "blur(18px)",
                          WebkitBackdropFilter: "blur(18px)",
                        }}
                      />
                      <div
                        style={{
                          borderRadius: 12,
                          background: `linear-gradient(135deg, ${opt.accent}, rgba(255,255,255,0.2))`,
                          boxShadow: "0 8px 18px rgba(15,23,42,0.10)",
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      insetInlineEnd: 12,
                      width: 30,
                      height: 30,
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.24)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: opt.textColor,
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    {opt.icon}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>
                      {active ? t("common.current") : t("common.mode")}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: active ? 700 : 600, color: active ? C.accent : C.text }}>{opt.label}</div>
                  </div>
                  <div
                    style={{
                      minWidth: 20,
                      height: 20,
                      padding: active ? "0 8px" : 0,
                      borderRadius: 999,
                      border: `1px solid ${active ? C.accentBdr : "transparent"}`,
                      background: active ? C.accentBg : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: active ? C.accent : C.textDim,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {active ? t("common.selected") : "○"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 10 }}>
          {t("settings.sections.layout")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {layoutOptions.map((opt) => {
            const active = settings.layoutMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => patchSettings({ layoutMode: opt.value })}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 12,
                  background: active ? "linear-gradient(180deg, var(--ci-surface-hi), var(--ci-surface))" : C.surface,
                  border: `1px solid ${active ? C.accentBdr : C.border}`,
                  borderRadius: 18,
                  cursor: "pointer",
                  textAlign: "start",
                  transition: "transform 0.16s, border-color 0.16s, box-shadow 0.16s, background 0.16s",
                  boxShadow: active ? `0 0 0 3px ${C.accentBg}, var(--ci-card-shadow-strong)` : "none",
                  transform: active ? "translateY(-1px)" : "translateY(0)",
                }}
              >
                <div
                  style={{
                    height: 118,
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    background: "linear-gradient(180deg, var(--ci-surface-hi), var(--ci-surface))",
                    padding: 14,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "stretch",
                    gap: opt.value === "split" ? 10 : 0,
                    color: C.textMuted,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "pre-line",
                  }}
                >
                  {opt.value === "split" ? (
                    <>
                      <div
                        style={{
                          width: "42%",
                          borderRadius: 10,
                          border: `1px solid ${C.border}`,
                          background: "var(--ci-surface)",
                          padding: 10,
                          boxSizing: "border-box",
                        }}
                      >
                        {t("settings.layoutOptions.split.left")}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          border: `1px solid ${C.accentBdr}`,
                          background: "var(--ci-accent-bg)",
                          color: C.accent,
                          padding: 10,
                          boxSizing: "border-box",
                        }}
                      >
                        {t("settings.layoutOptions.split.right")}
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        background: "var(--ci-surface)",
                        padding: 10,
                        boxSizing: "border-box",
                      }}
                    >
                      {opt.preview}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>
                      {active ? t("common.current") : t("common.layout")}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: active ? 700 : 600, color: active ? C.accent : C.text }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>{opt.desc}</div>
                  </div>
                  <div
                    style={{
                      minWidth: 20,
                      height: 20,
                      padding: active ? "0 8px" : 0,
                      borderRadius: 999,
                      border: `1px solid ${active ? C.accentBdr : "transparent"}`,
                      background: active ? C.accentBg : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: active ? C.accent : C.textDim,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {active ? t("common.selected") : "○"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ComponentsTab() {
  const { t } = useAppI18n();
  const { settings, patchSettings } = useSettingsStore();

  const groups: {
    title: string;
    items: { type: SplitWidgetCanvasItem["type"]; label: string; desc: string }[];
  }[] = [
    {
      title: t("settings.sections.rightWidgets"),
      items: [
        {
          type: "terminal",
          label: t("settings.components.terminal.label"),
          desc: t("settings.components.terminal.description"),
        },
        {
          type: "usage",
          label: t("settings.components.usage.label"),
          desc: t("settings.components.usage.description"),
        },
      ],
    },
  ];

  const isTypeVisible = (type: SplitWidgetCanvasItem["type"]) =>
    settings.splitWidgetCanvas.items.some((item) => item.type === type && item.visible !== false);

  const updateTypeVisibility = (type: SplitWidgetCanvasItem["type"], visible: boolean) => {
    const updateItems = (items: SplitWidgetCanvasItem[] | null | undefined) => {
      if (!items) return items ?? null;
      return items.map((item) => (item.type === type ? { ...item, visible } : item));
    };

    patchSettings({
      splitWidgetCanvas: {
        ...settings.splitWidgetCanvas,
        items: updateItems(settings.splitWidgetCanvas.items) ?? [],
        filledSnapshot: updateItems(settings.splitWidgetCanvas.filledSnapshot),
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map((group) => (
        <div key={group.title}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 10 }}>
            {group.title}
          </div>
          <div style={{ padding: "0 14px", background: "var(--ci-surface-hi)", borderRadius: 14 }}>
            {group.items.map((item, index) => (
              <Toggle
                key={item.type}
                value={isTypeVisible(item.type)}
                onChange={(value) => updateTypeVisibility(item.type, value)}
                label={item.label}
                desc={item.desc}
                showDivider={index < group.items.length - 1}
                labelStyle={{ fontSize: 14, fontWeight: 600 }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SystemTab() {
  const { t } = useAppI18n();
  const { settings, patchSettings } = useSettingsStore();
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<{ enabled: boolean } | null>(null);

  const localeOptions: { value: LocaleSetting; label: string }[] = [
    { value: "system", label: t("settings.locale.system") },
    { value: "zh-CN", label: t("settings.locale.zhCN") },
    { value: "en-US", label: t("settings.locale.enUS") },
    { value: "ar", label: t("settings.locale.ar") },
  ];

  const refreshIntegrationStatus = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<{ enabled: boolean }>("get_notifications_and_hooks_status");
      setIntegrationStatus({ enabled: status.enabled });
    } catch {}
  };

  useEffect(() => {
    void refreshIntegrationStatus();
  }, []);

  const handleToggleIntegrations = async () => {
    if (integrationBusy || !("__TAURI_INTERNALS__" in window)) return;

    const nextEnabled = !(integrationStatus?.enabled ?? true);
    setIntegrationBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("set_notifications_and_hooks_enabled", { enabled: nextEnabled });
      await refreshIntegrationStatus();
    } catch {
    } finally {
      setIntegrationBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 10 }}>
          {t("settings.locale.title")}
        </div>
        <div style={{ padding: "14px", background: "var(--ci-surface-hi)", borderRadius: 14, display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{t("settings.locale.description")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {localeOptions.map((option) => {
              const active = settings.locale === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => patchSettings({ locale: option.value })}
                  style={{
                    border: `1px solid ${active ? C.accentBdr : C.border}`,
                    background: active ? C.accentBg : C.surface,
                    color: active ? C.accent : C.text,
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, marginBottom: 10 }}>
          {t("common.notification")}
        </div>
        <div style={{ padding: "0 14px", background: "var(--ci-surface-hi)", borderRadius: 14 }}>
          <Toggle
            value={integrationStatus?.enabled ?? false}
            onChange={() => {
              void handleToggleIntegrations();
            }}
            label={t("common.notification")}
            disabled={integrationBusy || integrationStatus === null}
            showDivider={false}
            labelStyle={{ fontSize: 14, fontWeight: 600 }}
          />
        </div>
      </div>
    </div>
  );
}

type VisibleSettingsTab = "system" | "appearance" | "components";

function resolveVisibleSettingsTab(tab: string): VisibleSettingsTab {
  if (tab === "appearance" || tab === "components") return tab;
  return "system";
}

export default function Settings() {
  const { t } = useAppI18n();
  const { settings, settingsOpen, closeSettings, activeTab, setTab } = useSettingsStore();
  const isGlass = useSettingsStore((s) => isGlassTheme(s.settings.theme));
  const textShadow = isGlass ? "var(--ci-glass-text-shadow)" : "none";
  const strongTextShadow = isGlass ? "var(--ci-glass-text-shadow-strong)" : "none";
  const visibleTab = settings.layoutMode !== "split" && activeTab === "components" ? "appearance" : resolveVisibleSettingsTab(activeTab);
  const navItems: { value: VisibleSettingsTab; label: string }[] = [
    { value: "appearance", label: t("settings.tabs.appearance") },
    { value: "components", label: t("settings.tabs.components") },
    { value: "system", label: t("settings.tabs.system") },
  ];
  const visibleNavItems = settings.layoutMode === "split" ? navItems : navItems.filter((item) => item.value !== "components");

  if (!settingsOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: isGlass ? "transparent" : "var(--ci-overlay-bg)",
        backdropFilter: isGlass ? "none" : "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: isGlass ? "none" : "blur(28px) saturate(1.3)",
        borderRadius: isGlass ? 0 : "var(--ci-shell-radius)",
        display: "flex",
        padding: 0,
        boxSizing: "border-box",
        textShadow,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "transparent",
          border: "none",
          borderRadius: 0,
          boxShadow: "none",
        }}
      >
        <div
          data-tauri-drag-region
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px 14px",
            flexShrink: 0,
            background: isGlass ? "var(--ci-toolbar-bg)" : "transparent",
            cursor: "grab",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, marginBottom: 3 }}>
              {t("settings.preferences")}
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3, textShadow: strongTextShadow }}>
              {t("settings.title")}
            </span>
          </div>
          <button
            onClick={closeSettings}
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              background: "var(--ci-close-bg)",
              border: `0.5px solid var(--ci-close-border)` ,
              color: C.textMuted,
              cursor: "pointer",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isGlass ? "var(--ci-close-bg)" : "rgba(255,59,48,0.15)";
              e.currentTarget.style.color = C.red;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--ci-close-bg)";
              e.currentTarget.style.color = C.textMuted;
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "0 18px 18px", background: isGlass ? "var(--ci-bg-grad)" : "transparent" }}>
          <div style={{ minHeight: 0, height: "100%", borderRadius: 22, background: "transparent", boxShadow: "none", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap", padding: "0 18px", background: "transparent", flexShrink: 0 }}>
              {visibleNavItems.map((item) => {
                const active = visibleTab === item.value;
                return (
                  <button
                    key={item.value}
                    onClick={() => setTab(item.value)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "14px 0 12px",
                      marginBottom: -1,
                      border: "none",
                      borderBottom: `2px solid ${active ? C.accent : "transparent"}`,
                      background: "transparent",
                      color: active ? C.text : C.textMuted,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      transition: "border-color 0.16s, color 0.16s",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none", padding: 18 }}>
              {visibleTab === "appearance" ? <AppearanceTab /> : visibleTab === "components" ? <ComponentsTab /> : <SystemTab />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
