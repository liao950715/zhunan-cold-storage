/**
 * 行程內互斥鎖：所有庫存交易依序執行。
 * SQLite 同一時間只允許一個寫交易，Prisma 互動式交易在並發時會碰到 SQLITE_BUSY／連線逾時；
 * 單一伺服器行程下，以序列化加上交易內條件更新（WHERE quantity >= n）即可避免競爭（TECHNICAL_DESIGN §5.4）。
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const stockMutex = new Mutex();
