import { catalogModule } from './catalog/module.js';
import { customersModule } from './customers/module.js';
import { deliveryModule } from './delivery/module.js';
import { identityModule } from './identity/module.js';
import { marketingModule } from './marketing/module.js';
import { membershipModule } from './membership/module.js';
import { notificationModule } from './notification/module.js';
import { orderingModule } from './ordering/module.js';
import { paymentModule } from './payment/module.js';
import { reportingModule } from './reporting/module.js';
import { tenancyModule } from './tenancy/module.js';
import type { ModuleDefinition } from '../platform/modules.js';

export const allModules: readonly ModuleDefinition[] = [
  identityModule,
  tenancyModule,
  customersModule,
  catalogModule,
  orderingModule,
  deliveryModule,
  paymentModule,
  membershipModule,
  marketingModule,
  notificationModule,
  reportingModule,
];
