import assert from 'node:assert/strict'
import { propertyTokens, storedFormula, shownFormula } from '../../../src/domain/formula.ts'
const make=(name:string)=>({databases:new Map([['db',{properties:[{id:'p',name,type:'number'},{id:'r',name:'Related',type:'relation',target:'other'}],views:[]}],['other',{properties:[{id:'a',name:'Age',type:'number'}],views:[]}]]),programs:new Map()}) as any
const old=make('Price'), renamed=make('价格'), saved=storedFormula('Price + 1',old,'db')
assert.equal(shownFormula(saved,renamed,'db'),'价格 + 1')
assert.deepEqual(propertyTokens('价格 + 1',renamed,'db').map(t=>'价格 + 1'.slice(t.from,t.to)),['价格'])
for(const text of ['Related.map(current.Age)','Related.Age']) {
const t=propertyTokens(text,old,'db').map(t=>text.slice(t.from,t.to)); assert.deepEqual(t,['Related','Age']);
}
for(const text of ['(', 'Price +', 'Price + "', 'Price + @','let(Price, 3, Price)', 'Related.map(current.Age) +']) assert.doesNotThrow(()=>propertyTokens(text,old,'db'))
console.log('PASS rename by id, Chinese token, relation members, malformed inputs')
