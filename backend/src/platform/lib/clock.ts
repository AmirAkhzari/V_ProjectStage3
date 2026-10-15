export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function frozenClock(at: Date): Clock {
  return () => at;
}
