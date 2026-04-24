import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";
import { getLocaleDirection, isRtlLocale, resolveEffectiveLocale } from "./locale";

export function useAppI18n() {
  const localeSetting = useSettingsStore((state) => state.settings.locale);
  const effectiveLocale = resolveEffectiveLocale(localeSetting);
  const direction = getLocaleDirection(effectiveLocale);
  const { t, i18n } = useTranslation();

  return {
    t,
    i18n,
    localeSetting,
    locale: effectiveLocale,
    direction,
    isRtl: isRtlLocale(effectiveLocale),
  };
}
