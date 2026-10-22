// Synthetic local fake-Auth fixture only; never run this against a real account or deployment.
import assert from 'node:assert/strict';
const BASE='http://127.0.0.1:3423',AUTH='http://127.0.0.1:54992';
const count=async()=> (await (await fetch(AUTH+'/__calls')).json()).calls;
const before=await count(), statuses=[];
for(let i=0;i<11;i++) {
 const r=await fetch(BASE+'/api/auth/sign-in',{method:'POST',headers:{origin:BASE,'content-type':'application/json','x-forwarded-for':'10.112.112.112'},body:JSON.stringify({email:'owner@example.com',password:'owner-pass-1'})});statuses.push(r.status);
 const body=await r.text();assert.ok(!body.includes('owner-pass-1'));if(i===10)assert.ok(JSON.parse(body).retryAfter>0);
}
assert.deepEqual(statuses,[200,200,200,200,200,200,200,200,200,200,429]);assert.equal(await count()-before,10);
console.log('PASS IP brake in isolation: ten successful logins, then 429; exactly ten provider calls; no credential echoed');
