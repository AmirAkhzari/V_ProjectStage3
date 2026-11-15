import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { parse } from 'yaml';

let compiled: Record<string, ValidateFunction> | undefined;

function schemas(): Record<string, ValidateFunction> {
  if (compiled) return compiled;
  const yamlPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../openapi/openapi-v1.2.0.yaml',
  );
  const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
    components: { schemas: Record<string, object> };
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat('date-time', true);
  ajv.addFormat('uuid', true);
  ajv.addFormat('email', true);
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }
  compiled = {};
  for (const name of [
    'ShopkeeperRefreshSession',
    'StaffRefreshSession',
    'ShopkeeperSession',
    'StaffSession',
  ]) {
    const validator = ajv.getSchema(`#/components/schemas/${name}`);
    if (!validator) throw new Error(`${name} schema missing`);
    compiled[name] = validator;
  }
  return compiled;
}

export function refreshSchemaValidators(): {
  shopkeeper: ValidateFunction;
  staff: ValidateFunction;
} {
  const loaded = schemas();
  return {
    shopkeeper: loaded['ShopkeeperRefreshSession'] as ValidateFunction,
    staff: loaded['StaffRefreshSession'] as ValidateFunction,
  };
}

export function demoSessionValidators(): { shopkeeper: ValidateFunction; staff: ValidateFunction } {
  const loaded = schemas();
  return {
    shopkeeper: loaded['ShopkeeperSession'] as ValidateFunction,
    staff: loaded['StaffSession'] as ValidateFunction,
  };
}
