import { createRouteGroup, type RouteGroupSpec } from './group.js';

/** `/v1/admin` — staff surface (typ=staff). Scope header and permission hook are gated by E3-T4. */
export const adminGroupSpec: RouteGroupSpec = {
  group: 'admin',
  prefix: '/v1/admin',
  subject: 'staff',
};

export const adminGroup = createRouteGroup(adminGroupSpec);
