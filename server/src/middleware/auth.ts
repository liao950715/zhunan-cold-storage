import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** 所有需登入的路由：從 cookie 取 JWT，載入使用者（停用者視為未登入）。 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token: string | undefined = req.cookies?.[config.cookieName];
    if (!token) throw new AppError("UNAUTHENTICATED", 401, "請先登入");
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new AppError("UNAUTHENTICATED", 401, "登入已失效，請重新登入");
    }
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (!user || user.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", 401, "帳號不可用，請重新登入");
    req.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** 角色檢查（後端強制，NFR-04）。 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError("UNAUTHENTICATED", 401, "請先登入"));
    if (!roles.includes(req.user.role)) return next(new AppError("FORBIDDEN", 403, "您沒有執行此操作的權限"));
    next();
  };
}
