import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const root = path.resolve(import.meta.dirname, "../..");

export interface TestDb {
  pool: pg.Pool;
  name: string;
  drop(): Promise<void>;
}

/** Fresh database with the Supabase stubs and every migration applied, in order. */
export async function freshDb(): Promise<TestDb> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const name = `usmode_rls_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const files = [
    path.join(root, "supabase/tests/supabase_stubs.sql"),
    ...readdirSync(path.join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => path.join(root, "supabase/migrations", f)),
  ];
  for (const f of files) await pool.query(readFileSync(f, "utf8"));
  return {
    pool,
    name,
    async drop() {
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export type Q = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Run `fn` as an authenticated user (or anon), like PostgREST does, in one transaction. */
export async function as<T>(db: TestDb, userId: string | null, fn: (q: Q) => Promise<T>, opts: { topic?: string } = {}): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" })]);
    if (opts.topic) await c.query("select set_config('realtime.topic', $1, true)", [opts.topic]);
    const q: Q = async (sql, params) => (await c.query(sql, params as unknown[])).rows;
    const out = await fn(q);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Superuser access for setup and for checking what's really stored. */
export async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(db: TestDb, sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.pool.query<T>(sql, params as unknown[])).rows;
}

export const jwk = () => ({ kty: "EC", crv: "P-256", x: randomUUID(), y: randomUUID() });
export const lookup = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
