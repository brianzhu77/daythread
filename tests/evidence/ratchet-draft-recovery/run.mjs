import {execFileSync} from 'node:child_process';
for(const engine of ['chromium','webkit'])for(const scenario of ['thrown','thrown-twice','set-draft','lost','midnight','ready']){
 execFileSync(process.execPath,['tests/evidence/ratchet-draft-recovery/seed.ts']);
 console.log('CASE',engine,scenario);
 process.stdout.write(execFileSync(process.execPath,['tests/evidence/ratchet-draft-recovery/recovery.mjs','http://127.0.0.1:3693',scenario,engine],{encoding:'utf8'}));
}
