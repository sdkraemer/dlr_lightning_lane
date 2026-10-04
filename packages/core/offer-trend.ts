import { MAX_OBSERVATION_AGE, type Offer } from './alerts.ts';
import type { OfferHistory } from './offer-history.ts';

export type TrendSummary = {
  rate30PerHour: number | null;
  rate60PerHour: number;
  sampledMinutes: number;
  pace: 'Picking up' | 'Steady' | 'Slowing down' | 'Building trend' | 'Recent jump' | 'Not advancing';
};
export type TargetEstimate =
  | {
      status: 'estimate'; reachesAt: number; minutes: number; ratePerHour: number;
      minutesLow: number; minutesHigh: number; reachesAtLow: number; reachesAtHigh: number;
      trend: TrendSummary;
    }
  | {
      status: 'insufficient_data' | 'not_advancing' | 'stale' | 'unavailable' | 'too_slow' | 'recent_jump';
      trend?: TrendSummary;
    };

type Point = OfferHistory['points'][number];
function inWindow(points: Point[], from: number, to: number) {
  const selected = points.filter(point => point.observedAt >= from && point.observedAt <= to);
  const prior = points.findLast(point => point.observedAt < from);
  if (prior && from - prior.observedAt <= MAX_OBSERVATION_AGE && selected[0]?.observedAt !== from)
    selected.unshift({ ...prior, observedAt: from });
  return selected;
}

function fit(points: Point[]) {
  if (points.length < 3 || points.at(-1)!.observedAt - points[0].observedAt < 10 * 60_000)
    return null;
  const xs = points.map(point => (point.observedAt - points[0].observedAt) / 60_000);
  const ys = points.map(point => (point.returnStart - points[0].returnStart) / 60_000);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let numerator = 0, denominator = 0, advances = 0, largestJump = 0;
  for (let i = 0; i < points.length; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
    if (i > 0 && ys[i] > ys[i - 1]) {
      advances++;
      largestJump = Math.max(largestJump, ys[i] - ys[i - 1]);
    }
  }
  return { rate: numerator / denominator, span: xs.at(-1)!, advances,
    largestJump, gain: ys.at(-1)! };
}

export function estimateTarget(
  history: OfferHistory,
  current: Offer | undefined,
  earliest: number,
  latest: number,
  now = Date.now()
): TargetEstimate | null {
  const high = history.farthest ? Date.parse(history.farthest.return_start) : null;
  // Once the daily high-water mark reaches or passes the window, no ETA is needed.
  if (high !== null && high >= earliest) return null;
  if (!current) return { status: 'insufficient_data' };
  if (current.observed_at > now || now - current.observed_at > MAX_OBSERVATION_AGE)
    return { status: 'stale' };
  if (current.status !== 'OPERATING' || current.state !== 'AVAILABLE' ||
      !current.return_start || !current.return_end ||
      !Number.isFinite(Date.parse(current.return_start)) ||
      !Number.isFinite(Date.parse(current.return_end)) ||
      Date.parse(current.return_end) <= now ||
      Date.parse(current.return_end) < Date.parse(current.return_start))
    return { status: 'unavailable' };
  const points = history.points;
  if (high === null || points.length < 3 ||
      points.at(-1)!.observedAt - points[0].observedAt < 10 * 60_000 ||
      now - points.at(-1)!.observedAt > MAX_OBSERVATION_AGE ||
      points.some((point, index) => index > 0 &&
        point.observedAt - points[index - 1].observedAt > 10 * 60_000))
    return { status: 'insufficient_data' };

  // Compare separate half-hours for pace; use the recent and broad fits to
  // bracket the ETA. This is a range of pace scenarios, not a confidence interval.
  const broad = fit(points)!;
  const recent = fit(inWindow(points, now - 30 * 60_000, now));
  const previous = fit(inWindow(points, now - 60 * 60_000, now - 30 * 60_000));
  const rate = broad.rate;
  if (!Number.isFinite(rate) || rate <= 0) return { status: 'not_advancing' };
  const trend: TrendSummary = {
    rate30PerHour: recent && recent.span >= 25 ? recent.rate * 60 : null,
    rate60PerHour: rate * 60,
    sampledMinutes: broad.span,
    pace: 'Building trend',
  };
  if (recent && recent.rate <= 0) {
    trend.pace = 'Not advancing';
    return { status: 'not_advancing', trend };
  }
  if (recent && recent.gain > 0 &&
      (recent.advances < 2 || recent.largestJump / recent.gain > 0.75)) {
    trend.pace = 'Recent jump';
    return { status: 'recent_jump', trend };
  }
  if (recent && previous && recent.span >= 20 && previous.span >= 20) {
    const delta = recent.rate - previous.rate;
    const threshold = Math.max(Math.abs(previous.rate) * 0.25, 10 / 60);
    trend.pace = delta > threshold ? 'Picking up' : delta < -threshold ? 'Slowing down' : 'Steady';
  }
  const minutes = (earliest - high) / 60_000 / rate;
  const reachesAt = now + minutes * 60_000;
  const recentMinutes = recent ? (earliest - high) / 60_000 / recent.rate : minutes;
  const minutesLow = Math.min(minutes, recentMinutes);
  const minutesHigh = Math.max(minutes, recentMinutes);
  const reachesAtLow = now + minutesLow * 60_000;
  const reachesAtHigh = now + minutesHigh * 60_000;
  if (!Number.isFinite(reachesAtHigh) || reachesAtHigh > latest) return { status: 'too_slow' };
  return { status: 'estimate', reachesAt, minutes, ratePerHour: rate * 60,
    minutesLow, minutesHigh, reachesAtLow, reachesAtHigh, trend };
}
