/** 密碼雜湊：PBKDF2-SHA256（WebCrypto），格式 pbkdf2$<iterations>$<saltHex>$<hashHex>。 */
const ITER = 100_000;
const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${toHex(salt)}$${toHex(await derive(password, salt, ITER))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const got = toHex(await derive(password, fromHex(saltHex), Number(iter)));
  return timingSafeEqual(got, hashHex);
}

export function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const randomHex = (bytes = 32) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256Hex(text: string) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}
