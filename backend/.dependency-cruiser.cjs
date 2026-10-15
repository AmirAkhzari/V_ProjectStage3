/** @type {import('dependency-cruiser').IConfiguration} */
const MODULES = [
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
];

module.exports = {
  forbidden: [
    {
      name: 'platform-not-to-modules',
      comment: '§9.3.3 platform/** must not import modules/**',
      severity: 'error',
      from: { path: '^src/platform/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'bootstrap-no-mock-adapters',
      comment: 'M-5: main/worker/app must not import mock SMS/PSP/auth adapters',
      severity: 'error',
      from: { path: '^src/(app|main|worker)\\.ts$' },
      to: { path: 'src/modules/.*/(infra/mock/|infra/providers/mock\\.ts$)' },
    },
    {
      name: 'identity-pool-isolation',
      comment: '7-6: only identity code and the composition root may import the identity pool',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '^src/(main\\.ts$|modules/identity/)',
      },
      to: { path: '^src/modules/identity/infra/db/pool\\.ts$' },
    },
    {
      name: 'domain-no-infra-libs',
      comment: '§9.3.6 domain/ must not depend on Fastify, Drizzle or Redis',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: { path: 'node_modules/(fastify|drizzle-orm|ioredis|pg|@fastify)' },
    },
    ...MODULES.map((name) => ({
      name: `no-internals-of-${name}`,
      comment: `§9.3.1 other modules may only import ${name}/api.ts and ${name}/events.ts`,
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/',
        pathNot: `^src/modules/${name}/`,
      },
      to: {
        path: `^src/modules/${name}/`,
        pathNot: `^src/modules/${name}/(api|events)\\.ts$`,
      },
    })),
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs.json'],
    },
  },
};
