import{mergeDraft}from'../../../src/domain/draft-merge.ts';
const ref=(pageId:string)=>({id:'ref-line',type:'bulletListItem',props:{},content:[{type:'pageRef',props:{pageId,refId:'r-'+pageId}}],children:[]});
console.log('pure link base P, draft Q, latest P:',JSON.stringify(mergeDraft([ref('P')],[ref('Q')],[ref('P')],new Set()).document));
const checklist=(checked:boolean)=>({id:'check',type:'sourceChecklist',props:{checked},content:[{type:'text',text:'external checklist',styles:{}}],children:[]});
console.log('checklist base false, draft true, latest false:',JSON.stringify(mergeDraft([checklist(false)],[checklist(true)],[checklist(false)],new Set()).document));
