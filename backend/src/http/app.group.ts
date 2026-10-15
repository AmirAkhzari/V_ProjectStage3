import { createRouteGroup, type RouteGroupSpec } from './group.js';

/** `/v1/app` — shopkeeper surface (typ=shopkeeper). */
export const appGroupSpec: RouteGroupSpec = {
  group: 'app',
  prefix: '/v1/app',
  subject: 'shopkeeper',
};

export const appGroup = createRouteGroup(appGroupSpec);
