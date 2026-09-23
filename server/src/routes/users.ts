import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { parseBody, idParam } from "../middleware/validate.js";
import { hashPassword } from "../services/authService.js";

/** 使用者管理：僅 ADMIN（於 app.ts 掛 requireRole）。 */
export const usersRouter = Router();

const select = { id: true, username: true, displayName: true, role: true, status: true, createdAt: true } as const;

usersRouter.get("/", async (_req, res, next) => {
  try {
    const items = await prisma.user.findMany({ select, orderBy: { id: "asc" } });
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, "帳號僅能含英數字與 _ . -"),
  password: z.string().min(6, "密碼至少 6 碼"),
  displayName: z.string().min(1),
  role: z.enum(["ADMIN", "STAFF"]),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const input = parseBody(createSchema, req);
    if (await prisma.user.findUnique({ where: { username: input.username } })) {
      throw new AppError("CONFLICT", 409, `帳號「${input.username}」已存在`);
    }
    const user = await prisma.user.create({
      data: { ...input, password: undefined, passwordHash: await hashPassword(input.password) } as never,
      select,
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "STAFF"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  password: z.string().min(6).optional(),
});

usersRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = idParam(req);
    const input = parseBody(patchSchema, req);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound("使用者");
    if (id === req.user!.id && (input.status === "DISABLED" || (input.role && input.role !== "ADMIN"))) {
      throw new AppError("CONFLICT", 409, "不可停用或降級自己的帳號");
    }
    const { password, ...rest } = input;
    const user = await prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
      select,
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});
