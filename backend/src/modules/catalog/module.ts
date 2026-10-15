import type { ModuleDefinition } from '../../platform/modules.js';
import { adminRoutes } from './http/admin.routes.js';
import { appRoutes } from './http/app.routes.js';
import { driverRoutes } from './http/driver.routes.js';

export const catalogModule: ModuleDefinition = {
  name: 'catalog',
  routes: {
    app: appRoutes,
    admin: adminRoutes,
    driver: driverRoutes,
  },
};
