export const SUPPORTED_LOCALES = ["zh-CN", "en-US", "ar"] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number];
export type LocaleSetting = "system" | SupportedLocale;

export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

function normalizeLanguageTag(value: string) {
  return value.trim().replace(/_/g, "-").toLowerCase();
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocaleSetting(value: string | undefined): LocaleSetting {
  if (value === "system") return value;
  if (!value) return "system";
  const normalized = normalizeLanguageTag(value);
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
  if (normalized === "en" || normalized === "en-us") return "en-US";
  if (normalized === "ar" || normalized.startsWith("ar-")) return "ar";
  return "system";
}

export function resolveSupportedLocale(preferred: string | undefined | null): SupportedLocale {
  const normalized = normalizeLanguageTag(preferred ?? "");
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
  if (normalized === "en" || normalized === "en-us") return "en-US";
  if (normalized === "ar" || normalized.startsWith("ar-")) return "ar";
  return DEFAULT_LOCALE;
}

export function resolveEffectiveLocale(locale: LocaleSetting, systemLocale?: string | null): SupportedLocale {
  if (locale !== "system") return locale;
  return resolveSupportedLocale(systemLocale ?? (typeof navigator !== "undefined" ? navigator.language : undefined));
}

export function isRtlLocale(locale: SupportedLocale) {
  return locale === "ar";
}

export function getLocaleDirection(locale: SupportedLocale): "ltr" | "rtl" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}
