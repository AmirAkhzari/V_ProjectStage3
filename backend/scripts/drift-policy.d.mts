export const SCHEMAS: readonly string[];
export const ALLOWED_TABLES: ReadonlySet<string>;
export function checkMigrationSql(combined: string): string[];
