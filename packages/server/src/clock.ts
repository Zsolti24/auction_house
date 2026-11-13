/** Source of "now" for all domain decisions. Injected so tests can control time. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
