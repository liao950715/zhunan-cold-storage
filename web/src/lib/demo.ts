/**
 * 示範站（每個瀏覽器各一份示範資料）：每次開頁先向後端要這個瀏覽器的示範資料。
 * 按重新整理、或按「重置示範資料」→ 帶 fresh，後端在資料改過時換一份全新的。
 * 正式站回 {demo:false}，什麼都不做。
 */
const RESET_PARAM = "demo-reset";
let demo = false;

/** 目前是不是示範站（開頁時由後端告知） */
export const isDemo = () => demo;

/** 這次開頁是不是按了重新整理 */
function isReload() {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav) return nav.type === "reload";
  return (performance as unknown as { navigation?: { type: number } }).navigation?.type === 1; // 舊瀏覽器
}

export async function startDemoSession() {
  const url = new URL(window.location.href);
  const resetRequested = url.searchParams.has(RESET_PARAM);
  if (resetRequested) {
    url.searchParams.delete(RESET_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const res = await fetch("/api/demo/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fresh: resetRequested || isReload() }),
      signal: abort.signal,
    });
    if (res.ok) demo = ((await res.json()) as { demo?: boolean }).demo === true;
  } catch {
    // 連不到伺服器：照常啟動，畫面會顯示連線問題
  } finally {
    clearTimeout(timer);
  }
}

/** 「重置示範資料」：跟重新整理一樣換一份全新的示範資料，回到首頁（仍保持登入）。 */
export function resetDemoData() {
  window.location.assign(`/?${RESET_PARAM}=1`);
}
