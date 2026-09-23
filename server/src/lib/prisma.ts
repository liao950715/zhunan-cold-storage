import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** 互動式交易的 client 型別（stockService 等交易函式使用）。 */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
