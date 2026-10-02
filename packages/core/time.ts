import { Temporal } from '@js-temporal/polyfill';
export const TIMEZONE = 'America/Los_Angeles';
export function parkDate(now = Date.now()): string {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(TIMEZONE).toPlainDate().toString();
}
export function localInstant(date: string, time: string): number {
  return Temporal.PlainDateTime.from(date + 'T' + time)
    .toZonedDateTime(TIMEZONE, { disambiguation: 'reject' }).epochMilliseconds;
}

export function nextDate(date: string) { return Temporal.PlainDate.from(date).add({days:1}).toString(); }
