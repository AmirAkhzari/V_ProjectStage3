/**
 * `platform.settings` is a shared-kernel table, not a domain module. The table is not created in
 * Foundation; this is the future read API.
 */
export type PlatformSettingsApi = Readonly<Record<never, never>>;

export function createPlatformSettingsApi(): PlatformSettingsApi {
  return {};
}
