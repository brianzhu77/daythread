import assert from 'node:assert/strict'
import { mergeDraft } from '../../../src/domain/draft-merge.ts'
import { bodyFileUrl } from '../../../src/domain/body-files.ts'
const line = {id:'target', type:'paragraph', props:{}, content:[], children:[]}
const remote = {id:'remote',type:'paragraph',props:{},content:[{type:'text',text:'Other tab words',styles:{}}],children:[]}
const image={id:'target',type:'image',props:{url:bodyFileUrl('image1234','photo.png',70,'image/png'),name:'photo.png',caption:''},children:[]}
const merged=mergeDraft([line] as never,[image] as never,[line,remote] as never,new Set())
console.log(JSON.stringify(merged,null,2))
assert.equal(merged.document.find(n=>n.id==='target')?.type,'image','Load latest must preserve the new image kind')
