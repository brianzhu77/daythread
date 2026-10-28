// Throwaway Postgres for the local Supabase auth server (PR A rig). Never production.
import EmbeddedPostgres from 'embedded-postgres'
const pg = new EmbeddedPostgres({ databaseDir: '/tmp/rb-gotrue/pg/data', user: 'postgres', password: 'postgres', port: 54888, persistent: true })
import fs from 'node:fs'
if (!fs.existsSync('/tmp/rb-gotrue/pg/data/PG_VERSION')) await pg.initialise()
await pg.start()
const c = pg.getPgClient(); await c.connect()
await c.query(`do $$ begin
  if not exists (select from pg_roles where rolname='supabase_admin') then create user supabase_admin login createrole createdb replication bypassrls; end if;
  if not exists (select from pg_roles where rolname='supabase_auth_admin') then create user supabase_auth_admin noinherit createrole login noreplication password 'root'; end if;
end $$`)
await c.query(`create schema if not exists auth authorization supabase_auth_admin`)
await c.query(`grant create on database postgres to supabase_auth_admin`)
await c.query(`alter user supabase_auth_admin set search_path = 'auth'`)
await c.end()
console.log('pg ready on 54888')
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0) })
setInterval(() => {}, 1 << 30)
