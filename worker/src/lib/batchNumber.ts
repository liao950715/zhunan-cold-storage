import type { Db } from "./sql.js";

export const BATCH_NO_PATTERN = /^B\d{8}-\d{3,}$/;

/** 交易內取號：B{YYYYMMDD}-{NNN}；配合 Batch.batchNo UNIQUE 保證唯一（AT-02）。 */
export function nextBatchNo(db: Db, receivedDate: string): string {
  const dateKey = receivedDate.replace(/-/g, "");
  db.run("INSERT INTO BatchCounter (dateKey, seq) VALUES (?, 1) ON CONFLICT(dateKey) DO UPDATE SET seq = seq + 1", dateKey);
  const seq = db.one<{ seq: number }>("SELECT seq FROM BatchCounter WHERE dateKey = ?", dateKey)!.seq;
  return `B${dateKey}-${String(seq).padStart(3, "0")}`;
}
