import type { FastifyPluginAsync } from 'fastify';
import type { EventBus } from './events/bus.js';

/** Canonical module names (DL-10). `platform` is the 12th unit and lives in `src/platform`. */
export const MODULE_NAMES = [
  'identity',
  'tenancy',
  'customers',
  'catalog',
  'ordering',
  'delivery',
  'payment',
  'membership',
  'marketing',
  'notification',
  'reporting',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

/** One database schema per module, plus `platform` (§9.1). */
export const DB_SCHEMAS = [...MODULE_NAMES, 'platform'] as const;

export type RouteGroup = 'app' | 'admin' | 'driver';

export type ModuleRoutes = Partial<Record<RouteGroup, FastifyPluginAsync>>;

export interface ModuleContext {
  bus: EventBus;
}

export interface ModuleDefinition {
  name: ModuleName;
  /** Routes the module contributes to each API surface (§9.3 rule 4). */
  routes: ModuleRoutes;
  /** Subscribes event handlers and jobs. */
  register?(ctx: ModuleContext): void | Promise<void>;
}
