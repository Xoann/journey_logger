export function dayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDay(date, offset) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + offset);
  return dayString(result);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || dayString(new Date(`${value}T12:00:00`)) !== value) {
    throw new Error('Date must be a valid YYYY-MM-DD.');
  }
  return value;
}
export function normalizeResetTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('Use a reset time from 00:00 to 23:59.');
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}
export const dayResetTime = data => normalizeResetTime(data.settings?.dayResetTime ?? '00:00');
export function configureDayReset(data, value) {
  const time = normalizeResetTime(value);
  data.settings = { ...data.settings, dayResetTime: time };
  return time;
}
export function trackingDay(data, now = new Date()) {
  const [hour, minute] = dayResetTime(data).split(':').map(Number);
  // Compare local wall-clock time, rather than subtracting hours across DST changes.
  return shiftDay(dayString(now), now.getHours() * 60 + now.getMinutes() < hour * 60 + minute ? -1 : 0);
}
export function resolveLogDate(value, data = {}, now = new Date()) {
  const today = trackingDay(data, now);
  if (!value || value.toLowerCase() === 'today') return today;
  if (value.toLowerCase() === 'yesterday') return shiftDay(today, -1);
  return validDate(value);
}
