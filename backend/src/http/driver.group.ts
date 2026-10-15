import { createRouteGroup, type RouteGroupSpec } from './group.js';

/** `/v1/driver` — driver surface (typ=driver). */
export const driverGroupSpec: RouteGroupSpec = {
  group: 'driver',
  prefix: '/v1/driver',
  subject: 'driver',
};

export const driverGroup = createRouteGroup(driverGroupSpec);
