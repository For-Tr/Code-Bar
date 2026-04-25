import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { localeMessages } from "./messages";
import { DEFAULT_LOCALE, type SupportedLocale } from "./locale";

function flattenMessages(tree: Record<string, unknown>, prefix = "") {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      acc[nextKey] = value;
      return acc;
    }
    if (value && typeof value === "object") {
      Object.assign(acc, flattenMessages(value as Record<string, unknown>, nextKey));
    }
    return acc;
  }, {});
}

const resources = Object.fromEntries(
  Object.entries(localeMessages).map(([locale, messages]) => [locale, { translation: flattenMessages(messages as Record<string, unknown>) }])
);

let initialized = false;

export async function ensureI18n(locale: SupportedLocale) {
  if (!initialized) {
    await i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: Object.keys(resources),
      resources,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    initialized = true;
    return i18n;
  }

  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale);
  }
  return i18n;
}

export function getI18n() {
  return i18n;
}
