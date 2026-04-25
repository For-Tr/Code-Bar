import { resolveEffectiveLocale, type LocaleSetting } from "./locale";

function getLocale(locale?: LocaleSetting | string | null) {
  if (!locale) return resolveEffectiveLocale("system");
  if (locale === "system") return resolveEffectiveLocale(locale);
  return resolveEffectiveLocale(locale as LocaleSetting);
}

export function formatDate(value: Date | number | string, locale?: LocaleSetting | string | null) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(getLocale(locale)).format(date);
}

export function formatTime(value: Date | number | string, locale?: LocaleSetting | string | null) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(getLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatPercent(value: number, locale?: LocaleSetting | string | null, digits = 0) {
  return new Intl.NumberFormat(getLocale(locale), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
