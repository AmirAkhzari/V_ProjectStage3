export const DEMO_ISS = 'vproject-demo';
export const DEMO_AUD = 'vproject-demo';

/** Routes exist only for this exact pair. `TRUE` and `1` do not enable them. */
export function demoLoginEnabled(nodeEnv: string, flag: string | undefined): boolean {
  return nodeEnv !== 'production' && flag === 'true';
}
