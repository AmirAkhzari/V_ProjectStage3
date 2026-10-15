/**
 * Append-only audit log helper (P0-E7-T2). Actor types follow the architecture document.
 * Postgres: `PgAuditWriter` against `platform.audit_log`.
 */
export interface AuditEntry {
  actorType: 'shopkeeper' | 'staff' | 'driver' | 'system';
  actorId: string;
  actorName: string;
  distributorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  data: unknown;
  ip: string | null;
}

export interface AuditWriter<TTx> {
  append(tx: TTx, entry: AuditEntry): Promise<void>;
}

export class InMemoryAuditWriter implements AuditWriter<unknown> {
  readonly entries: AuditEntry[] = [];

  append(_tx: unknown, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}
