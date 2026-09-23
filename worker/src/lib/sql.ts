/** Durable Object SQLite 的小型封裝：同步 API，交易用 ctx.storage.transactionSync。 */
export type Row = Record<string, string | number | null>;

export class Db {
  constructor(private readonly storage: DurableObjectStorage) {}

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.storage.sql.exec(sql, ...params).toArray() as T[];
  }
  one<T = Row>(sql: string, ...params: unknown[]): T | null {
    const rows = this.storage.sql.exec(sql, ...params).toArray();
    return (rows[0] as T) ?? null;
  }
  run(sql: string, ...params: unknown[]): number {
    return this.storage.sql.exec(sql, ...params).rowsWritten;
  }
  insert(sql: string, ...params: unknown[]): number {
    this.storage.sql.exec(sql, ...params);
    return this.one<{ id: number }>("SELECT last_insert_rowid() AS id")!.id;
  }
  /** 整段同步執行；丟例外即回滾。 */
  tx<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
  exec(sql: string) {
    this.storage.sql.exec(sql);
  }
}

export const nowIso = () => new Date().toISOString();
