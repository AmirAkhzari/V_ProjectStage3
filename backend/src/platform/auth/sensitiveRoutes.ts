import type { FastifyRequest } from 'fastify';

/**
 * Default-deny registry of operations that must hit PG (`fresh`), not live cache.
 * C11 / B83 / logout-all / finance at minimum. S3 (public PSP callback) is excluded.
 */
export const SENSITIVE_OPERATION_IDS = new Set([
  'C11',
  'C3',
  'B83',
  'B4',
  'A34',
  'A35',
  'A36',
  'A37',
  'A38',
  'A42',
  'B51',
  'B52',
  'B53',
  'B82',
]);

export function isSensitiveOperation(operationId: string): boolean {
  return SENSITIVE_OPERATION_IDS.has(operationId);
}

export function routeOperationId(request: FastifyRequest): string | undefined {
  const schema = request.routeOptions.schema as { operationId?: string } | undefined;
  return typeof schema?.operationId === 'string' ? schema.operationId : undefined;
}

/**
 * Default-deny: listed operationIds and explicit `config.sensitive` hit PG.
 * Unknown YAML payment/C11/B83/logout-all ops fail the contract-list test
 * until they are added here. Catch-all 404s have no operationId and stay cached.
 */
export function requiresFreshSession(
  request: FastifyRequest,
  groupFresh: boolean | undefined,
): boolean {
  if (groupFresh === true) return true;
  if (request.routeOptions.config.sensitive === true) return true;
  const operationId = routeOperationId(request);
  return operationId !== undefined && isSensitiveOperation(operationId);
}
