import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readPack } from '../dist/pack/index.js';
import { validatePlan } from '../dist/core/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]||'work/google-smoke');
const demo=spawnSync(process.execPath,[join(root,'scripts/demo.mjs'),out],{cwd:root,stdio:'inherit'});
if(demo.status!==0)throw new Error('Creating a new synthetic demo failed. Choose a new output directory.');
const {catalog}=await readPack(join(out,'pack'));
const base=JSON.parse(await readFile(join(out,'plan.json'),'utf8'));
const ids=['demo-brief'], cases=[];
async function add(id,expected_ok,description,transform){
  const plan=structuredClone(base);transform(plan);
  const checked=validatePlan(plan,catalog,ids);
  if(checked.ok!==expected_ok)throw new Error(`Unexpected local validation result for ${id}`);
  const file=id+'.json';await writeFile(join(out,file),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  cases.push({id,file,expected_ok,pages:plan.slides.length,description});
}
await add('01-normal',true,'通常文。3ページ・固定文字・表・ノートとPDFを確認する。',()=>{});
await add('02-short',true,'最短文。各登録欄に1文字を入れる。',p=>p.slides.forEach(s=>Object.keys(s.fields).forEach(k=>{s.fields[k]='短';})));
await add('03-boundary',true,'仕様上限の日本語。収まらなければ容量設定を見直す。',p=>p.slides.forEach(s=>Object.keys(s.fields).forEach(k=>{
  const spec=catalog.manifest.templates.find(t=>t.id===s.template_id);s.fields[k]='あ'.repeat(spec.fields[k].max_chars);
})));
await add('04-newlines',true,'見出し1行、本文3行。改行・折り返し・表を確認する。',p=>p.slides.forEach(s=>Object.keys(s.fields).forEach(k=>{
  const spec=catalog.manifest.templates.find(t=>t.id===s.template_id);s.fields[k]=Array.from({length:spec.fields[k].max_lines},(_,i)=>`${i+1}行目の確認`).join('\n');
})));
await add('05-repeat',true,'先頭の原本ページを末尾で繰り返す。4ページの順序を確認する。',p=>{
  const repeated=structuredClone(p.slides[0]);repeated.instance_id='page-repeat';p.slides.push(repeated);
});
await add('06-update',true,'01の作成結果を更新する。本文を手修正して保持・上書きを比較する。',p=>p.slides.forEach(s=>Object.keys(s.fields).forEach(k=>{s.fields[k]='更新案：'+s.fields[k];})));
await add('07-reject-capacity',false,'見出しが上限超過。反映前に拒否され、資料が変わらないこと。',p=>{
  const spec=catalog.manifest.templates.find(t=>t.id===p.slides[0].template_id);p.slides[0].fields.title='あ'.repeat(spec.fields.title.max_chars+1);
});
await add('08-reject-source',false,'未登録の根拠ID。反映前に拒否されること。',p=>{p.slides[0].evidence.body=['not-supplied'];});
await add('09-reject-empty',false,'必須見出しが空。反映前に拒否されること。',p=>{p.slides[0].fields.title='';});
await writeFile(join(out,'smoke-cases.json'),JSON.stringify({schema_version:'1',synthetic:true,google_executed:false,template_pack:catalog.pack,sources:ids,cases},null,2)+'\n',{flag:'wx'});
await writeFile(join(out,'RUNBOOK.md'),`# 実Googleの試験用サンプル

このフォルダは架空資料です。ローカルの仕様検査は実施済みですが、Google上の試験はまだ実行していません。モデルAPIと会社資料は不要です。承認記録は作りません。

1. pack/source/template.pptx をGoogle Slidesへ変換し、google/ の7ファイルを紐づくApps Scriptへ設置します。設定手順はリポジトリのdocs/google-slides-setup.mdを参照します。
2. 「設定・状態を確認」で未登録の原本候補を確認し、表示を比較してから「表示確認したテンプレートを登録」を実行します。原本は保存し、以下は別コピーで試します。
3. サイドバーの情報の名前へ demo-brief と入力し、01〜05をそれぞれ新しい原本コピーで試します。各JSONを「回答」へそのまま貼ります。通常の作成と同じ確認・反映ボタンを使います。枚数、固定部分、文字書式、表、改行、ノートとPDFを目視で比較します。
4. 01の作成済みコピーの最初の本文をSlidesで「手修正を保持する」に変更し、06を確認します。未選択で保持されることを試し、別のコピーではその欄の上書きを明示的に選びます。
5. 07〜09は反映前に拒否され、資料・ノートが変わらないことを確認します。未登録の追加ページ、固定部分の編集、確認後の本文編集でも停止することを確認します。診断は読取専用です。
6. 完了した作業資料でノート削除が拒否されることを確認します。別コピーでノートを削除し、本文と元資料のノートが維持されることを確認します。
7. サイドバーを開き直す、同じコピーへ戻る、原本から再作成する操作を試します。保留記録がある場合は、自動では反映せず同じ内容を復元することを確認します。強制中断の試験は捨てられるコピーで行い、自動復旧を完全保証しません。

実施日、Workspaceの環境、実施者、各結果、PDFやスクリーンショット、復元結果、未解決の差を組織が選ぶ非公開の場所へ保存します。「仕様検査が通る」と「描画が合格」は別です。最大文字数で溢れる場合は容量を下げ、再生成して試します。実機結果を伴わない本番承認はしません。
`,{flag:'wx'});
console.log(`Synthetic Google smoke cases created: ${out}. Actual Google execution is still required.`);
