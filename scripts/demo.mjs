import pptxgen from 'pptxgenjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { importPack, readPack } from '../dist/pack/index.js';
import { emptyPlan } from '../dist/core/index.js';
import { spawnSync } from 'node:child_process';

const out = resolve(process.argv[2] || 'work/demo');
await mkdir(dirname(out), { recursive: true });
await mkdir(out, { recursive: false });
const pptx = new pptxgen(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'ai-slide-template';
pptx.subject = 'Synthetic template fixture — no actual company or customer data';
pptx.title = 'Northstar Lab · Template examples'; pptx.lang = 'ja-JP';
const ink = '152B46', blue = '2365A7', muted = '687B92', line = 'DDE5EE';
function page(number, section) {
  const s = pptx.addSlide(); s.background = { color: 'FAFBFD' };
  s.addText('NORTHSTAR LAB', { x: .6, y: .35, w: 4, h: .3, fontFace: 'Arial', fontSize: 12, bold: true, color: blue, margin: 0 });
  s.addText(section, { x: 9, y: .35, w: 3.7, h: .3, fontFace: 'Arial', fontSize: 10, align: 'right', color: muted, margin: 0 });
  s.addShape(pptx.ShapeType.line, { x: .6, y: .92, w: 12.1, h: 0, line: { color: line, width: 1 } });
  s.addText('{{title}}', { x: .7, y: 1.3, w: 11.9, h: .85, fontFace: 'Arial', fontSize: 30, bold: true, color: ink, margin: 0 });
  s.addText('架空の資料 · 検証専用', { x: .7, y: 6.9, w: 6, h: .25, fontFace: 'Arial', fontSize: 9, color: muted, margin: 0 });
  s.addText(String(number).padStart(2,'0'), { x: 12, y: 6.85, w: .6, h: .3, fontFace: 'Arial', fontSize: 11, align: 'right', color: muted, margin: 0 });
  return s;
}
let s = page(1, 'OVERVIEW');
s.addText('{{body}}', { x: .75, y: 2.7, w: 11.8, h: 2.4, fontFace: 'Arial', fontSize: 22, color: ink, margin: 0, breakLine: false });
s = page(2, 'COMPARISON');
for (const [x, tag, label] of [[.75,'left','選択肢 A'],[6.9,'right','選択肢 B']]) {
  s.addShape(pptx.ShapeType.rect, { x, y: 2.55, w: 5.65, h: 3.25, fill: { color: 'FFFFFF' }, line: { color: line, width: 1 } });
  s.addText(label, { x: x+.3, y: 2.9, w: 4.9, h: .4, fontFace: 'Arial', fontSize: 14, bold: true, color: blue, margin: 0 });
  s.addText('{{'+tag+'}}', { x: x+.3, y: 3.65, w: 4.9, h: 1.65, fontFace: 'Arial', fontSize: 19, color: ink, margin: 0 });
}
s = page(3, 'NEXT STEPS');
s.addTable([
  [{text:'確認する項目',options:{bold:true}},{text:'内容',options:{bold:true}}],
  ['実施範囲','{{scope}}'],['次の判断','{{decision}}']
], { x: .75, y: 2.65, w: 11.8, h: 2.4, colW: [3.2,8.6], rowH: .8, fontFace: 'Arial', fontSize: 18, color: ink,
  fill: 'FFFFFF', border: { type:'solid', color: line, pt: 1 }, margin: .15, autoPage: false });
const source = join(out,'input.pptx'); await pptx.writeFile({ fileName: source });
const pack = join(out,'pack'); await importPack(source,pack,'northstar-demo');
const m = JSON.parse(await readFile(join(pack,'template.json'),'utf8'));
const purposes = ['今回の判断と背景を短く説明する','同じ基準で2つの選択肢を比較する','実施範囲と次に決めることを整理する'];
const labels = {title:'見出し',body:'背景と目的',left:'選択肢A',right:'選択肢B',scope:'実施範囲',decision:'次の判断'};
m.templates.forEach((t,i) => { t.purpose = purposes[i]; for (const [k,f] of Object.entries(t.fields)) { f.label=labels[k]; f.max_chars=k==='title'?40:100; f.max_lines=k==='title'?1:3; } });
await writeFile(join(pack,'template.json'),JSON.stringify(m,null,2)+'\n');
const {catalog} = await readPack(pack), plan = emptyPlan(catalog);
const values = [
  {title:'提案資料の作成方法を検証する',body:'承認済みの見た目を保ち、案件ごとの文章を更新する。\nまず小さな用途から、確認と修正を含む時間を比較する。'},
  {title:'2つの方法を同じ条件で比較する',left:'過去資料を手動で流用する。\n現在の業務の比較基準にする。',right:'指定欄の内容をAIが提案する。\n検証後に既存ページへ反映する。'},
  {title:'試行範囲と次の判断',scope:'短文・比較・小さな表の3種類を使う。',decision:'品質と総作業時間を確認し、継続するか判断する。'}
];
plan.purpose='資料作成方法の試行範囲を合意する';
plan.slides.forEach((slide,i) => { slide.fields=values[i]; for(const key of Object.keys(slide.fields)){slide.evidence[key]=['demo-brief'];slide.status[key]='confirmed';} });
await writeFile(join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');
await writeFile(join(out,'sources.json'),'["demo-brief"]\n');
const run = spawnSync(process.execPath,['bin/ai-slide-template.js','build-google','--pack',pack,'--out',join(out,'google'),'--draft'],{stdio:'inherit'});
if(run.status!==0) process.exitCode=1;
console.log(`Draft demo created: ${out}. Google rendering and local restoration still need human checks.`);
