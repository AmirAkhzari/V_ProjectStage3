export const DEMO_ISS = 'vproject-demo';
export const DEMO_AUD = 'vproject-demo';

/**
 * One switch for config, route registration, and the token factory.
 * `TRUE` and `1` do not enable it. Staging is the only production deploy that may.
 */
export function demoLoginEnabled(
  nodeEnv: string,
  deployEnv: string | undefined,
  flag: string | undefined,
): boolean {
  return (nodeEnv !== 'production' || deployEnv === 'staging') && flag === 'true';
}
