import { getRequestConfig } from "next-intl/server";
import { defaultLocale, getDictionary } from "@eserp/i18n";

/**
 * next-intl is used for locale routing only. The actual message
 * dictionaries live in @eserp/i18n and are handed to next-intl here,
 * so every UI string still comes from the shared dictionaries.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? defaultLocale;
  return {
    locale,
    messages: getDictionary(locale),
  };
});
