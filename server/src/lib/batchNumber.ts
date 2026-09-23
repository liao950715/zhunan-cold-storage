import type { Tx } from "./prisma.js";

export const BATCH_NO_PATTERN = /^B\d{8}-\d{3,}$/;

/** 交易內取號：B{YYYYMMDD}-{NNN}；配合 Batch.batchNo UNIQUE 保證唯一（AT-02）。 */
export async function nextBatchNo(tx: Tx, date: Date): Promise<string> {
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");
  const counter = await tx.batchCounter.upsert({
    where: { dateKey },
    create: { dateKey, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `B${dateKey}-${String(counter.seq).padStart(3, "0")}`;
}
