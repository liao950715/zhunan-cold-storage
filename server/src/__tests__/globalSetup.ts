import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 每次測試前重建 prisma/test.db 並套用 migrations（含 CHECK 約束）。 */
export default function setup() {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dbPath = path.join(serverDir, "prisma/test.db");
  for (const f of [dbPath, `${dbPath}-journal`]) if (existsSync(f)) rmSync(f);
  execSync("npx prisma migrate deploy", {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
