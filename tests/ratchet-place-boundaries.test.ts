import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient, type SqlClient } from '../src/server/db/sql.ts'
import { MemoryPlaceLimiter, PostgresPlaceLimiter } from '../src/server/place-limits.ts'
import { resetPlaceSearch, searchPlaces } from '../src/server/place-search.ts'

test('Ratchet: HTTP-date Retry-After prevents a call until the provider deadline', async () => {
 resetPlaceSearch(); let now = Date.parse('2026-11-14T10:00:00Z'), calls=0
 const limiter=new MemoryPlaceLimiter()
 const fetcher=(async()=>{calls++; return calls===1 ? new Response('',{status:429,headers:{'retry-after':new Date(now+600_000).toUTCString()}}) : new Response('{"features":[]}')}) as typeof fetch
 const d={fetch:fetcher,limiter,owner:'one',now:()=>now}
 assert.equal((await searchPlaces({q:'Stanley Park',explicit:true},d)).status,'limit')
 now+=61_000
 assert.equal((await searchPlaces({q:'West Lake',explicit:true},d)).status,'limit')
 assert.equal(calls,1)
})

test('Ratchet: a transient limiter initialization failure can recover on the next request', async()=>{
 const db=await PGlite.create(), real=pgliteClient(db); let first=true
 const flaky:SqlClient={...real,query:async <T extends object>(s:string,p?:unknown[]):Promise<T[]>=>{if(first){first=false;throw new Error('temporary database failure')}return real.query<T>(s,p)}}
 const limiter=new PostgresPlaceLimiter(flaky,'ratchet_place_recovery')
 try {
  await assert.rejects(limiter.take('one',new Date()))
  assert.equal(await limiter.take('one',new Date()),true)
 }finally{await db.close()}
})
