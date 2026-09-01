// Ported from public/js/modules/utils.js's formatTimeWithOffset. Renders a
// date as HH:MM after shifting it by the user's configured timezone offset
// (hours), using UTC getters so the result doesn't depend on the browser's
// own timezone/locale.
export function formatTimeWithOffset(date: Date | string, offsetHours = 0): string {
  const d = date instanceof Date ? date : new Date(date);
  const adjustedTime = new Date(d.getTime() + offsetHours * 3600000);

  const hours = adjustedTime.getUTCHours().toString().padStart(2, '0');
  const minutes = adjustedTime.getUTCMinutes().toString().padStart(2, '0');

  return `${hours}:${minutes}`;
}
