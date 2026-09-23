export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: "12h" as const,
  cookieName: "token",
  isProduction: process.env.NODE_ENV === "production",
};
