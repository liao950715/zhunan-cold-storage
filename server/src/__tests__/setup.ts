// 在任何 prisma import 之前設定測試資料庫
process.env.DATABASE_URL = "file:./test.db";
process.env.JWT_SECRET = "test-secret";
