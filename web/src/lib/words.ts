/** 儲位代碼的白話說明：A-01-03 → 「A 庫 1 號架 3 格」。 */
export function locationWords(code: string): string {
  const m = /^([A-Za-z0-9]+)-(\d+)-(\d+)$/.exec(code);
  if (!m) return code;
  return `${m[1]} 庫 ${Number(m[2])} 號架 ${Number(m[3])} 格`;
}
export const locationLabel = (code: string) => `${code}（${locationWords(code)}）`;
