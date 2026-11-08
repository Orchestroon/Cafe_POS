import i18n from "./index";

// One place for display formatting. Money/quantities stay decimal strings as returned by the API.
export const formatMoney = (amount: string, currency: string) => `${amount} ${currency}`;

export function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}
