// Better Auth 实例 + 建表。
//
// 数据库直接传 `bun:sqlite` 实例 —— Better Auth 的 kysely 适配器官方内置
// BunSqliteDialect,识别 `fileControl` 特征自动切换,不需要任何原生模块。
// 建表用官方推荐的编程式迁移 `getMigrations`(`better-auth/db/migration`),
// 示例自包含,不需要 `npx auth@latest migrate` CLI。

import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import type { Auth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

export interface AuthOptions {
  /** SQLite 文件路径,默认 `:memory:`(进程内,重启即清空)。 */
  dbPath?: string;
  /** 应用基地址,默认 `http://localhost:3003`。 */
  baseURL?: string;
  /** 会话签名密钥(生产环境务必用环境变量,至少 32 字符)。 */
  secret?: string;
}

export async function createAuth(opts: AuthOptions = {}): Promise<{
  auth: Auth<any>;
  db: Database;
}> {
  const db = new Database(opts.dbPath ?? ":memory:");
  const auth = betterAuth({
    database: db,
    secret: opts.secret ?? "better-auth-example-secret-0123456789abcdef",
    baseURL: opts.baseURL ?? "http://localhost:3003",
    emailAndPassword: { enabled: true },
  });

  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();

  return { auth, db };
}
