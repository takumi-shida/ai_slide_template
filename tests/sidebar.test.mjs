import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { catalog, plan } from './fixtures.mjs';
import { runtime } from './mock-slides.mjs';
class Element {
  constructor(){this.value='';this.children=[];this.listeners={};this.dataset={};this.disabled=false;this.checked=false;}
  addEventListener(event,fn){this.listeners[event]=fn;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  querySelectorAll(){return this.children.flatMap(child=>child instanceof Element ? [...(child.type==='checkbox'?[child]:[]),...child.querySelectorAll()] : []);}
  async dispatch(event){if(!this.disabled)await this.listeners[event]?.();}
}
function sidebar(r,p){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let sequence=0;
  const context=vm.createContext({
    document:{getElementById:get,createElement:()=>new Element(),createTextNode:text=>text},
    structuredClone,crypto:{randomUUID:()=>`sidebar-request-${++sequence}`},navigator:{clipboard:{writeText:async()=>{}}},
    google:{script:{run:{withSuccessHandler(success){return {withFailureHandler(fail){return new Proxy({}, {get:(_,name)=>(...args)=>{try{success(r.call(name,...args));}catch(error){fail(error);}}});}};}}}}
  });
  const script=/<script>([\s\S]*?)<\/script>/.exec(readFileSync('apps/slides-addon/Sidebar.html','utf8'))[1];
  vm.runInContext(script,context);get('sources').value='brief';get('answer').value=JSON.stringify(p);
  return {get};
}
test('actual sidebar and server preserve a manual field while applying another update',async()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();r.apply(p,r.preview(p).token);
  r.slides[0].shapes[1].text='Human title';const q=structuredClone(p);q.slides[0].fields.title='AI title';q.slides[0].fields.body='Revised body';
  const ui=sidebar(r,q);await ui.get('preview').dispatch('click');
  assert.equal(ui.get('apply').disabled,false);
  assert.equal(ui.get('changes').querySelectorAll().length,1);
  assert.equal(ui.get('changes').querySelectorAll()[0].checked,false);
  await ui.get('apply').dispatch('click');
  assert.equal(r.slides[0].shapes[1].text,'Human title');assert.equal(r.slides[0].shapes[2].text,'Revised body');
  assert.equal(ui.get('apply').disabled,true);assert.match(ui.get('status').textContent,/反映しました/);
});
test('actual sidebar permits only explicitly selected manual-field overwrite',async()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();r.apply(p,r.preview(p).token);r.slides[0].shapes[1].text='Human title';
  const ui=sidebar(r,p);await ui.get('preview').dispatch('click');ui.get('changes').querySelectorAll()[0].checked=true;
  await ui.get('apply').dispatch('click');assert.equal(r.slides[0].shapes[1].text,p.slides[0].fields.title);
});
test('actual sidebar retains the request across cleanup failure and retry',async()=>{
  const c=catalog(),p=plan(c),r=runtime(c);r.register();const ui=sidebar(r,p);await ui.get('preview').dispatch('click');
  r.failRemove=r.slides[0].id;await ui.get('apply').dispatch('click');assert.equal(r.slides.length,2);
  assert.match(ui.get('status').textContent,/再試行/);assert.equal(ui.get('apply').disabled,false);
  await ui.get('apply').dispatch('click');assert.equal(r.slides.length,1);assert.match(ui.get('status').textContent,/反映しました/);
});
