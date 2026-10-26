import type { PGlite, Transaction } from '@electric-sql/pglite'
import type { Sql, TransactionSql } from 'postgres'

/** The few operations the migration runner and the tests need, over PGlite or postgres.js alike. */
export interface SqlClient {
  /** One or more statements, no parameters (migration files). */
  exec(sql: string): Promise<void>
  query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
}

export function pgliteClient(db: PGlite | Transaction): SqlClient {
  return {
    exec: async sql => { await db.exec(sql) },
    query: async <T extends object,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
    transaction: fn => 'transaction' in db ? (db as PGlite).transaction(tx => fn(pgliteClient(tx))) : fn(pgliteClient(db)),
  } as SqlClient
}

export function postgresClient(sql: Sql | TransactionSql): SqlClient {
  return {
    exec: async text => { await sql.unsafe(text) },
    query: async <T,>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[],
    transaction: fn => 'begin' in sql ? (sql as Sql).begin(tx => fn(postgresClient(tx))) as Promise<never> : fn(postgresClient(sql)),
  } as SqlClient
}
