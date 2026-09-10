import type { MissionStop } from '../types';

const MINUTE = 60_000;

const timestamp = (value: Date | string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const windowStartOnDepartureDay = (time: string | undefined, departure: number): number | undefined => {
  if (!time || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  // Business dates and delivery windows are expressed in Réunion time, regardless
  // of the device/browser time zone.
  const date = new Date(departure + 4 * 60 * MINUTE).toISOString().slice(0, 10);
  return Date.parse(`${date}T${time.padStart(5, '0')}:00+04:00`);
};

/**
 * Recompute arrivals from the actual departure, travel legs and service at the
 * PREVIOUS stop. Waiting until a customer's window opens is retained.
 * Old missions without travel legs use their existing schedule as a baseline;
 * if neither travel nor a baseline is available, an ETA cannot be promised.
 */
export const recalculateStopEtas = (
  stops: MissionStop[],
  actualDeparture: Date | string,
  plannedDeparture?: Date | string,
): MissionStop[] => {
  const actual = timestamp(actualDeparture);
  if (actual === undefined) throw new Error('Heure de départ invalide.');
  const planned = timestamp(plannedDeparture);
  const shift = planned === undefined ? undefined : actual - planned;
  let previousDeparture: number | undefined = actual;

  return stops.map(stop => {
    const travel = stop.durationFromPrevious;
    const hasTravel = typeof travel === 'number' && Number.isFinite(travel) && travel >= 0;
    const oldArrival = timestamp(stop.estimatedArrival);
    let arrival: number | undefined;
    if (hasTravel && previousDeparture !== undefined) {
      arrival = previousDeparture + travel * MINUTE;
    } else if (oldArrival !== undefined && shift !== undefined) {
      // Do not compress an old schedule into a zero-minute journey. Also keep a
      // preceding stop's service if it now ends later than the shifted baseline.
      arrival = Math.max(oldArrival + shift, previousDeparture ?? actual);
    }

    const { estimatedArrival: _oldArrival, estimatedDeparture: _oldDeparture, ...rest } = stop;
    if (arrival === undefined) {
      previousDeparture = undefined;
      return rest;
    }
    const windowStart = windowStartOnDepartureDay(stop.timeWindowStart, actual);
    if (windowStart !== undefined) arrival = Math.max(arrival, windowStart);
    const service = Number.isFinite(stop.serviceTime) && stop.serviceTime >= 0 ? stop.serviceTime : 5;
    previousDeparture = arrival + service * MINUTE;
    return {
      ...rest,
      estimatedArrival: new Date(arrival).toISOString(),
      estimatedDeparture: new Date(previousDeparture).toISOString(),
    };
  });
};
