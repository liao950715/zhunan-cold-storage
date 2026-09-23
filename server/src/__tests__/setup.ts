// 在任何 prisma import 之前設定測試資料庫（單一連線，配合 stockMutex 序列化寫入）
process.env.DATABASE_URL = "file:./test.db?connection_limit=1";
process.env.JWT_SECRET = "test-secret";
