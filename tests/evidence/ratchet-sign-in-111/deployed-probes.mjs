// Read-only / invalid-input probes: no email, model call, or workspace command is submitted.
// Lead runs with REVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET in environment, never CLI arguments.
const base = new URL(process.env.REVIEW_URL ?? 'http://127.0.0.1:3421');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
let failures = 0;
async function probe(label, path, expected, init = {}) {
  const r = await fetch(new URL(path, base), { ...init, redirect: 'manual', headers: {...headers, ...init.headers} });
  const ok = r.status === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${r.status} expected ${expected}`);
  if (expected === 302 && !r.headers.get('location')?.startsWith('/sign-in?next=')) {
    failures++; console.log('FAIL redirect is not the application sign-in gate');
  }
  await r.arrayBuffer(); // Do not print journal content, response bodies, cookies or bypass values.
}
for (const path of ['/', '/tasks', '/pages', '/calendar', '/review']) await probe(`anonymous page ${path}`, path, 302);
for (const path of ['/api/unknown', '/_serverFn/nonexistent']) await probe(`anonymous direct GET ${path}`, path, 401);
const ids = (process.env.SERVER_FUNCTION_IDS ?? '668f9e940cb0147258fa8e3038b7692ea648d4ea5c6b56e5f0b83b8c61dff1b0,4bf19e25556a9519662d6159116875d620d92de09000dbf4f50b107cb43eee35,ee0fdcc0a4f54b02f4cd5afffdc9b66c7962cbee7660f6c17ed59cf187931151,9f7786239a8bd4fd129089e52d1cffe79bf9c0bb064c96ea3a7087dacd765d78,9cb2fa6807b487cf71ada1b845f9de9977de036f8a1c473ea02e7f9d97e8bf3f,623df68faa2d9c62ddebb897c04e1a44eee7bb6732c6c1ae28f6990519d110d8').split(',').filter(Boolean);
for (let i=0; i<ids.length; i++) {
  await probe(`anonymous real server function ${i+1} GET`, `/_serverFn/${ids[i]}`, 401);
  await probe(`anonymous real server function ${i+1} POST`, `/_serverFn/${ids[i]}`, 401, { method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:'{}' });
}
for (const path of ['/api/auth/send','/api/auth/verify','/api/auth/sign-out']) {
  for (const [name, extra] of [['cross-origin',{origin:'https://example.invalid'}],['cross-site',{'sec-fetch-site':'cross-site',origin:base.origin}],['no-origin',{}]]) {
    await probe(`${name} ${path}`,path,403,{method:'POST',headers:{'content-type':'application/json',...extra},body:'{}'});
  }
}
await probe('public sign-in page','/sign-in',200);
console.log(`${failures} failures`);process.exitCode = failures ? 1 : 0;
