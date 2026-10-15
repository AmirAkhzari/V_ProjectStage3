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
