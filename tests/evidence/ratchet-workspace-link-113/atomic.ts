// Disposable local Postgres only: binding/session rollback and pool-local admin flag.
import assert from 'node:assert/strict';import postgres from 'postgres';
import {postgresClient} from '../../../src/server/db/sql.ts';import {PostgresWorkspaceRepository} from '../../../src/server/postgres-repository.ts';import {SessionStore} from '../../../src/server/auth/sessions.ts';
const raw=postgres('postgres://postgres:fixture@127.0.0.1:54781/review',{prepare:false,max:1,onnotice:()=>{}}),sql=postgresClient(raw),schema='ratchet113atomicfinal';
const repo=new PostgresWorkspaceRepository(sql,schema),store=new SessionStore(sql,schema,{workspace:schema+'.workspace'}),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';await repo.prepare();
const before=(await raw.unsafe(`select revision,data::text d,ledger::text l from ${schema}.workspace`))[0];
await assert.rejects(store.attempt(async tx=>{await repo.link(tx,A);await store.create(A,'owner@example.com',new Date(),tx);throw Error('fixture fail after session insert')}),/fixture fail/);
assert.equal((await raw.unsafe(`select user_id from ${schema}.workspace`))[0].user_id,null);assert.equal((await raw.unsafe(`select count(*)::int n from ${schema}.sessions`))[0].n,0);assert.deepEqual((await raw.unsafe(`select revision,data::text d,ledger::text l from ${schema}.workspace`))[0],before);console.log('PASS injected failure after link and session insert: both rolled back, content/revision/ledger unchanged');
await sql.transaction(tx=>repo.link(tx,A));await raw.begin(async tx=>{await tx.unsafe("set local daythread.allow_relink='on'");await tx.unsafe(`update ${schema}.workspace set user_id=$1::uuid`,[B])});
await assert.rejects(raw.unsafe(`update ${schema}.workspace set user_id=$1::uuid`,[A]),/account link can't be changed/);console.log('PASS admin SET LOCAL does not leak onto reused pool connection');await raw.end();
