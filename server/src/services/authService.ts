import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import type { AuthUser } from "../middleware/auth.js";

export async function login(username: string, password: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok) throw new AppError("UNAUTHENTICATED", 401, "帳號或密碼錯誤");
  if (user.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", 401, "此帳號已停用");
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
