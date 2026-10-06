import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let counter=0;
class Range {
  constructor(owner,key){this.owner=owner;this.key=key;}
  asString(){return this.owner[this.key]+'\n';}
  setText(value){if(this.owner.runtime.failText===value){this.owner.runtime.failText=null;throw new Error('injected write failure');}this.owner[this.key]=value;return this;}
  getTextStyle(){return {getFontFamily:()=> 'Arial',getFontSize:()=>20,isBold:()=>false,isItalic:()=>false,getForegroundColor:()=>({getColorType:()=> 'RGB',asRgbColor:()=>({asHexString:()=> '#152B46'})})};}
}
class Shape {
  constructor(runtime,text,x=1){this.runtime=runtime;this.text=text;this.id='shape-'+(++counter);this.x=x;}
  getPageElementType(){return 'SHAPE';}getObjectId(){return this.id;}asShape(){return this;}
  getText(){return new Range(this,'text');}getLeft(){return this.x;}getTop(){return 1;}getWidth(){return 100;}getHeight(){return 30;}getRotation(){return 0;}
}
class Table extends Shape {
  constructor(runtime,text){super(runtime,'');this.cells=[{runtime,text:'FIXED CELL',merge:'NORMAL'},{runtime,text,merge:'NORMAL'}];}
  getPageElementType(){return 'TABLE';}asTable(){return this;}
  getNumRows(){return 1;}getNumColumns(){return 2;}
  getCell(_,column){const cell=this.cells[column];return {getText:()=>new Range(cell,'text'),getMergeState:()=>cell.merge};}
}
class Group extends Shape {
  constructor(runtime,children){super(runtime,'');this.children=children;}
  getPageElementType(){return 'GROUP';}asGroup(){return this;}getChildren(){return this.children;}
}
function cloneElement(e,runtime){
  if(e instanceof Group)return new Group(runtime,e.children.map(child=>cloneElement(child,runtime)));
  if(e instanceof Table){const copy=new Table(runtime,e.cells[1].text);copy.cells.forEach((c,i)=>Object.assign(c,{text:e.cells[i].text,merge:e.cells[i].merge}));return copy;}
  return new Shape(runtime,e.text,e.x);
}
class Slide {
  constructor(runtime,texts,notes='Presenter notes'){this.runtime=runtime;this.id='slide-'+(++counter);this.shapes=texts.map((text,i)=>new Shape(runtime,text,i));this.notes=notes;}
  getObjectId(){return this.id;}getPageElements(){return this.shapes;}
  getNotesPage(){return {getSpeakerNotesShape:()=>({getText:()=>new Range(this,'notes')})};}
  duplicate(){const copy=new Slide(this.runtime,[],this.notes);copy.shapes=this.shapes.map(s=>cloneElement(s,this.runtime));this.runtime.slides.splice(this.runtime.slides.indexOf(this)+1,0,copy);return copy;}
  move(index){this.runtime.slides.splice(this.runtime.slides.indexOf(this),1);this.runtime.slides.splice(index,0,this);}
  remove(){if(this.runtime.failRemove===this.id){this.runtime.failRemove=null;throw new Error('injected cleanup failure');}this.runtime.slides.splice(this.runtime.slides.indexOf(this),1);}
}
export function runtime(catalog,variant='shapes') {
  const r={slides:[],failText:null,failRemove:null,locked:false};
  r.slides=[new Slide(r,['FIXED BRAND','{{title}}','{{body}}'])];
  if(variant==='table')r.slides[0].shapes[2]=new Table(r,'{{body}}');
  if(variant==='group')r.slides[0].shapes[2]=new Group(r,[r.slides[0].shapes[2]]);
  const ui={Button:{YES:'YES'},ButtonSet:{YES_NO:'YES_NO'},alert:()=> 'YES'};
  r.context=vm.createContext({AST_CATALOG:structuredClone(catalog),
    SlidesApp:{getActivePresentation:()=>({getSlides:()=> [...r.slides]}),getUi:()=>ui},
    LockService:{getDocumentLock:()=>({tryLock:()=>{if(r.locked)return false;r.locked=true;return true;},releaseLock:()=>{r.locked=false;}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()]}
  });
  vm.runInContext(readFileSync('build/Core.gs','utf8'),r.context);
  vm.runInContext(readFileSync('apps/slides-addon/Addon.gs','utf8'),r.context);
  r.call=(name,...args)=>r.context[name](...args);
  r.register=()=>r.call('registerCurrentTemplate');
  r.preview=p=>r.call('previewAnswer',JSON.stringify(p),'brief');
  r.apply=(p,token,id='request-0001',overwrite=[])=>r.call('applyAnswer',JSON.stringify(p),'brief',token,id,overwrite);
  return r;
}
