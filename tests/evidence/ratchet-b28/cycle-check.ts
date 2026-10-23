import assert from 'node:assert/strict'
import {asTaskTree} from '../../../src/domain/task-tree.ts'
const a=new Map([['A',{parents:['B'],from:'2026-10-23'}],['B',{parents:['C'],from:'2026-10-21'}],['C',{parents:['A'],from:'2026-10-22'}],['D',{parents:['C'],from:'2026-10-23'}]])
for(const ids of [['A','B','C','D'],['D','C','B','A'],['C','A','D','B']]){const r=asTaskTree(ids,x=>x,a);assert.equal(r[0].item,'B');assert.equal(r.find(x=>x.item==='B')?.depth,0);assert.equal(r.find(x=>x.item==='A')?.depth,1);assert.equal(r.find(x=>x.item==='C')?.depth,2);assert.equal(r.find(x=>x.item==='D')?.depth,3)}
let seed=174;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296}
for(let n=0;n<10000;n++){const ids=Array.from({length:1+Math.floor(rnd()*30)},(_,i)=>String(i));const map=new Map(ids.map(id=>[id,{parents:Array.from({length:Math.floor(rnd()*8)},()=>String(Math.floor(rnd()*35))),from:String(Math.floor(rnd()*10))}]));const rows=asTaskTree(ids,x=>x,map);assert.equal(rows.length,ids.length);assert.equal(new Set(rows.map(r=>r.item)).size,ids.length);assert.ok(rows.every(r=>r.depth>=0&&r.depth<ids.length))}
console.log('PASS: three-node cycle drops oldest edge under three list permutations; 10000 independent randomized graphs retain every task exactly once')
