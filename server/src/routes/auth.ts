import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { authenticate, signToken } from "../middleware/auth.js";
import { parseBody } from "../middleware/validate.js";
import { login } from "../services/authService.js";

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1, "請輸入帳號"), password: z.string().min(1, "請輸入密碼") });

authRouter.post("/login", async (req, res, next) => {
  try {
    const { username, password } = parseBody(loginSchema, req);
    const user = await login(username, password);
    res.cookie(config.cookieName, signToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(config.cookieName);
  res.json({ ok: true });
});

authRouter.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});
