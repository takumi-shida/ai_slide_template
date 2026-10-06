/** @OnlyCurrentDoc */
var AST_BEGIN = '\n[AI_SLIDE_TEMPLATE_STATE_V1]\n';
var AST_END = '\n[/AI_SLIDE_TEMPLATE_STATE_V1]';

function onOpen() {
  SlidesApp.getUi().createMenu('AI資料作成').addItem('作成・修正', 'showSidebar')
    .addItem('表示確認したテンプレートを登録', 'registerCurrentTemplate')
    .addItem('設定・状態を確認', 'showTemplateDiagnostics')
    .addItem('配布コピーのノートを削除', 'prepareDistributionCopy').addToUi();
}
function onInstall() { onOpen(); }
function showSidebar() {
  SlidesApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('AI資料作成'));
}
function astHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
}
function astCatalog_() {
  var c = AST_CATALOG, m = SlideCore.validateManifest(c.manifest);
  if (!m.ok) throw new Error('テンプレートの仕様が不正です。');
  if (c.pack.id !== c.manifest.id || c.pack.version !== c.manifest.version) throw new Error('テンプレートの版が不一致です。');
  if (c.release && (!SlideCore.validateRelease(c.release).ok || c.release.content_hash !== c.pack.content_hash)) throw new Error('承認記録が一致しません。');
  return c;
}
function astText_(range) { return range.asString().replace(/\n$/, ''); }
function astNotes_(slide) {
  var shape = slide.getNotesPage().getSpeakerNotesShape();
  if (!shape) throw new Error('ノートへ状態を保存できません。');
  return shape.getText();
}
function astState_(slide) {
  var notes = astNotes_(slide).asString(), start = notes.indexOf(AST_BEGIN);
  if (start < 0) return null;
  if (notes.indexOf(AST_BEGIN, start + 1) >= 0) throw new Error('状態記録が重複しています。');
  var end = notes.indexOf(AST_END, start);
  if (end < 0) throw new Error('状態記録が破損しています。');
  var state;
  try { state = JSON.parse(notes.slice(start + AST_BEGIN.length, end)); } catch (_) { throw new Error('状態記録が読めません。'); }
  if (!state || state.schema_version !== '1' || !state.pack || !state.bindings || !state.fixed_hash || !['template', 'deck'].includes(state.kind)) throw new Error('状態記録の形式が不正です。');
  if (SlideCore.canonical(state.pack) !== SlideCore.canonical(astCatalog_().pack)) throw new Error('資料とテンプレートの版が一致しません。');
  return state;
}
function astSave_(slide, state) {
  var range = astNotes_(slide), text = range.asString(), start = text.indexOf(AST_BEGIN);
  if (start >= 0) {
    var end = text.indexOf(AST_END, start);
    if (end < 0) throw new Error('状態記録が破損しています。');
    text = text.slice(0, start) + text.slice(end + AST_END.length);
  }
  range.setText(text.replace(/\n$/, '') + AST_BEGIN + JSON.stringify(state) + AST_END);
}
function astCells_(slide) {
  var cells = [];
  function walk(elements) {
    elements.forEach(function(e) {
      var type = String(e.getPageElementType());
      if (type === 'GROUP') { walk(e.asGroup().getChildren()); return; }
      if (type === 'SHAPE') cells.push({ id: e.getObjectId(), range: e.asShape().getText(), element: e });
      if (type === 'TABLE') {
        var table = e.asTable();
        for (var r = 0; r < table.getNumRows(); r++) for (var c = 0; c < table.getNumColumns(); c++) {
          var cell = table.getCell(r, c);
          // Merged cells are not writable slots in v0.1.
          if (typeof cell.getMergeState === 'function' && String(cell.getMergeState()) !== 'NORMAL') continue;
          cells.push({ id: e.getObjectId(), row: r, column: c, range: cell.getText(), element: e });
        }
      }
    });
  }
  walk(slide.getPageElements()); return cells;
}
function astBindingKey_(cell) { return cell.id + ':' + (cell.row === undefined ? 'shape' : cell.row + ':' + cell.column); }
function astResolve_(slide, binding) {
  var match = astCells_(slide).filter(function(c) { return astBindingKey_(c) === astBindingKey_(binding); });
  if (match.length !== 1) throw new Error('変更対象の欄が削除・変更されています。');
  return match[0];
}
function astBindings_(slide, spec) {
  var cells = astCells_(slide), bindings = {};
  Object.keys(spec.fields).forEach(function(key) {
    var matches = cells.filter(function(c) { return astText_(c.range) === spec.fields[key].tag; });
    if (matches.length !== 1) throw new Error(spec.id + ' / ' + key + ' のタグが一意ではありません。');
    var cell = matches[0], style = cell.range.getTextStyle();
    if (style.getFontFamily() === null || style.getFontSize() === null || style.isBold() === null || style.isItalic() === null) throw new Error('可変欄の文字書式を統一してから登録してください。');
    bindings[key] = { id: cell.id };
    if (cell.row !== undefined) { bindings[key].row = cell.row; bindings[key].column = cell.column; }
  });
  cells.forEach(function(cell) {
    var value = astText_(cell.range);
    if (/\{\{.*?\}\}/.test(value) && !Object.keys(bindings).some(function(k) { return astBindingKey_(bindings[k]) === astBindingKey_(cell); })) throw new Error('未登録・部分置換のタグがあります。');
  });
  return bindings;
}
function astColor_(color) {
  if (!color) return null;
  var type = String(color.getColorType());
  if (type === 'RGB') return color.asRgbColor().asHexString();
  if (type === 'THEME') return String(color.asThemeColor().getThemeColorType());
  return type;
}
function astSignature_(slide, bindings) {
  var mutable = Object.keys(bindings).map(function(k) { return astBindingKey_(bindings[k]); });
  var items = [];
  function fill(fill) {
    if (!fill) return null;
    var type = typeof fill.getFillType === 'function' ? String(fill.getFillType()) : typeof fill.getType === 'function' ? String(fill.getType()) : '';
    var result = { type: type };
    if (type === 'SOLID' && typeof fill.getSolidFill === 'function') {
      var solid = fill.getSolidFill(); result.color = astColor_(solid.getColor());
      if (typeof solid.getAlpha === 'function') result.alpha = solid.getAlpha();
    }
    if (type === 'PICTURE' && typeof fill.getPictureFill === 'function') result.source = fill.getPictureFill().getSourceUrl();
    return result;
  }
  if (typeof slide.getBackground === 'function') items.push({ background: fill(slide.getBackground()) });
  function walk(elements) {
    elements.forEach(function(e) {
      var type = String(e.getPageElementType());
      var row = { type: type, left: e.getLeft(), top: e.getTop(), width: e.getWidth(), height: e.getHeight(), rotation: e.getRotation() };
      if (type === 'SHAPE') {
        var shape = e.asShape();
        if (typeof shape.getShapeType === 'function') row.shape = String(shape.getShapeType());
        if (typeof shape.getFill === 'function') row.fill = fill(shape.getFill());
        if (typeof shape.getBorder === 'function') {
          var border = shape.getBorder();
          row.border = { fill: fill(border.getLineFill()), weight: border.getWeight(), dash: String(border.getDashStyle()) };
        }
      }
      if (type === 'GROUP') { items.push(row); walk(e.asGroup().getChildren()); return; }
      if (type === 'IMAGE' && typeof e.asImage().getSourceUrl === 'function') row.image_source = e.asImage().getSourceUrl();
      items.push(row);
    });
  }
  walk(slide.getPageElements());
  astCells_(slide).forEach(function(cell) {
    var style = cell.range.getTextStyle();
    items.push({ kind: 'text', row: cell.row, column: cell.column,
      text: mutable.includes(astBindingKey_(cell)) ? '[mutable]' : astText_(cell.range),
      font: style.getFontFamily(), size: style.getFontSize(), bold: style.isBold(), italic: style.isItalic(),
      color: astColor_(style.getForegroundColor()) });
  });
  return astHash_(SlideCore.canonical(items));
}
function registerCurrentTemplate() {
  var ui = SlidesApp.getUi();
  if (ui.alert('テンプレート登録', '表示・固定部分・ノートを確認済みの作業コピーですか？登録後に原本から再配置する試験も行ってください。', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。');
  try {
    var c = astCatalog_(), slides = SlidesApp.getActivePresentation().getSlides();
    if (slides.length !== c.manifest.templates.length) throw new Error('原本とページ数が異なります。未加工のコピーで登録してください。');
    var prepared = c.manifest.templates.map(function(t) {
      var slide = slides[t.slide_index];
      if (!slide) throw new Error('原本ページがありません。');
      var old = astState_(slide);
      if (old && old.kind === 'deck') throw new Error('作成済み資料をテンプレートへ再登録できません。');
      if (old && old.fixed_hash !== astSignature_(slide, old.bindings)) throw new Error('登録後に固定部分が変わっています。原本から新しい版を整備してください。');
      var bindings = astBindings_(slide, t);
      return { slide: slide, state: { schema_version: '1', kind: 'template', pack: c.pack, template_id: t.id,
        bindings: bindings, fixed_hash: astSignature_(slide, bindings) } };
    });
    prepared.forEach(function(p) { astSave_(p.slide, p.state); });
    ui.alert('登録しました。AI資料作成メニューから作成・修正を開いてください。');
  } finally { lock.releaseLock(); }
}
function astSources_(text) {
  var ids = (text || '').split(/[\n,]/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (ids.length > 500 || ids.some(function(id) { return id.length > 200; })) throw new Error('根拠IDの一覧が大きすぎます。');
  return ids;
}
function getPrompt(sourceText) {
  var c = astCatalog_(); return { prompt: SlideCore.buildPrompt(c, astSources_(sourceText)), draft: !c.release };
}
function astPrepare_(answer, sourceText) {
  var c = astCatalog_(), parsed = SlideCore.parsePlan(answer);
  var checked = parsed.ok ? SlideCore.validatePlan(parsed.value, c, astSources_(sourceText)) : parsed;
  if (!checked.ok) return { ok: false, issues: checked.issues };
  var plan = checked.value, slides = SlidesApp.getActivePresentation().getSlides();
  var entries = slides.map(function(slide) { return { slide: slide, state: astState_(slide) }; });
  if (entries.some(function(e) { return !e.state; })) throw new Error('状態記録がありません。未加工の原本コピーを登録するか、更新用資料を使ってください。');
  var sources = entries.filter(function(e) { return e.state.kind === 'template'; });
  var generated = entries.filter(function(e) { return e.state.kind === 'deck'; });
  entries.forEach(function(e) {
    var spec = c.manifest.templates.find(function(t) { return t.id === e.state.template_id; });
    if (!spec || SlideCore.canonical(Object.keys(e.state.bindings).sort()) !== SlideCore.canonical(Object.keys(spec.fields).sort())) throw new Error('登録した欄の仕様が異なります。');
    Object.keys(e.state.bindings).forEach(function(k) { astResolve_(e.slide, e.state.bindings[k]); });
    if (e.state.fixed_hash !== astSignature_(e.slide, e.state.bindings)) throw new Error('固定部分・配置・文字書式が変わっています。更新前に確認してください。');
  });
  var changes = [], mode;
  if (generated.length) {
    if (sources.length) throw new Error('生成後の整理が未完了です。同じ実行を再試行してください。');
    mode = 'update';
    if (generated.length !== plan.slides.length) throw new Error('ページの追加・削除は、原本から新しい作業コピーを作ってください。');
    var found = {};
    plan.slides.forEach(function(s, i) {
      var e = generated[i];
      if (e.state.instance_id !== s.instance_id || e.state.template_id !== s.template_id || found[s.instance_id]) throw new Error('ページ順・用途が異なります。原本から新しい作業コピーを作ってください。');
      found[s.instance_id] = true;
      if (e.state.phase !== 'complete' || !e.state.baseline_hashes) throw new Error('前の実行が未完了です。更新を止めます。');
      var current = {};
      Object.keys(e.state.bindings).forEach(function(k) { current[k] = astText_(astResolve_(e.slide, e.state.bindings[k]).range); });
      changes = changes.concat(SlideCore.diffFields(s.instance_id, s.fields, current, e.state.baseline_hashes, astHash_));
    });
  } else {
    mode = 'create';
    plan.slides.forEach(function(s) {
      var matches = sources.filter(function(e) { return e.state.template_id === s.template_id; });
      if (matches.length !== 1) throw new Error('対応する原本ページが一意ではありません。');
      astBindings_(matches[0].slide, c.manifest.templates.find(function(t) { return t.id === s.template_id; }));
      Object.keys(s.fields).forEach(function(k) { changes.push({ instance_id: s.instance_id, field: k, current: '', proposed: s.fields[k], conflict: false }); });
    });
  }
  var currentState = entries.map(function(e) {
    return { page: e.slide.getObjectId(), state: e.state, values: astCells_(e.slide).map(function(x) { return astText_(x.range); }) };
  });
  return { ok: true, mode: mode, plan: plan, entries: entries, changes: changes,
    token: astHash_(SlideCore.canonical({ plan: plan, sources: astSources_(sourceText), state: currentState })), draft: !c.release };
}
function previewAnswer(answer, sourceText) {
  var prepared = astPrepare_(answer, sourceText);
  if (!prepared.ok) return prepared;
  var displayChanges = prepared.changes.map(function(change) {
    var page = prepared.plan.slides.findIndex(function(s) { return s.instance_id === change.instance_id; });
    var spec = astCatalog_().manifest.templates.find(function(t) { return t.id === prepared.plan.slides[page].template_id; });
    return Object.assign({}, change, { page_number: page + 1, label: spec.fields[change.field].label });
  });
  return { ok: true, token: prepared.token, mode: prepared.mode, plan: prepared.plan, changes: displayChanges,
    questions: prepared.plan.questions, draft: prepared.draft,
    warnings: ['根拠の内容と表示の収まりは、反映後も確認してください。', '外部共有は別コピーを作り、AI資料作成メニューから配布コピーのノートを削除してください。'] };
}
function astRetry_(plan, requestId, pending) {
  var slides = SlidesApp.getActivePresentation().getSlides();
  var entries = slides.map(function(slide) { return { slide: slide, state: astState_(slide) }; });
  var generated = entries.filter(function(e) { return e.state && e.state.kind === 'deck'; });
  if (!generated.length || !generated.every(function(e) { return e.state.request_id === requestId; })) return null;
  if (entries.some(function(e) { return !e.state; })) throw new Error('再試行前にページ構成が変わっています。追加ページを含む資料を確認してください。');
  if (generated.length !== plan.slides.length || !generated.every(function(e, i) { return e.state.instance_id === plan.slides[i].instance_id && e.state.template_id === plan.slides[i].template_id && e.state.plan_hash === astHash_(SlideCore.canonical(plan)); })) throw new Error('同じ実行IDに異なる内容は指定できません。');
  generated.forEach(function(e) {
    if (!['rendered', 'complete'].includes(e.state.phase)) throw new Error('再試行するページが途中状態です。担当者に確認してください。');
    if (e.state.fixed_hash !== astSignature_(e.slide, e.state.bindings)) throw new Error('再試行前に資料の固定部分が変わっています。');
    Object.keys(e.state.bindings).forEach(function(k) {
      if (astHash_(astText_(astResolve_(e.slide, e.state.bindings[k]).range)) !== e.state.baseline_hashes[k]) throw new Error('再試行前に本文が変わっています。新しいプレビューを作ってください。');
    });
  });
  var sources = entries.filter(function(e) { return e.state && e.state.kind === 'template'; });
  sources.forEach(function(e) {
    var spec = astCatalog_().manifest.templates.find(function(t) { return t.id === e.state.template_id; });
    if (!spec || e.state.fixed_hash !== astSignature_(e.slide, e.state.bindings)) throw new Error('再試行前に原本の固定部分が変わっています。');
    astBindings_(e.slide, spec);
  });
  astSavePending_(pending);
  sources.forEach(function(e) { e.slide.remove(); });
  generated.forEach(function(e) { e.state.phase = 'complete'; astSave_(e.slide, e.state); });
  return { ok: true, reused: true, pages: generated.length };
}
function applyAnswer(answer, sourceText, token, requestId, overwrite) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('実行IDが不正です。');
  if (!Array.isArray(overwrite) || !overwrite.every(function(k) { return typeof k === 'string'; })) throw new Error('修正対象の指定が不正です。');
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。');
  try {
    var c = astCatalog_(), parsed = SlideCore.parsePlan(answer);
    var checked = parsed.ok ? SlideCore.validatePlan(parsed.value, c, astSources_(sourceText)) : parsed;
    if (!checked.ok) return checked;
    var pending = { text: answer, sourceText: sourceText, token: token, id: requestId, overwrite: overwrite };
    var saved = astPending_();
    if (saved && astAscii_(saved.pending) !== astAscii_(pending)) throw new Error('前回の反映が未確認です。同じ実行を再試行するか、記録を解除して確認し直してください。');
    var retry = astRetry_(checked.value, requestId, pending); if (retry) return astFinish_(requestId, retry);
    var p = astPrepare_(answer, sourceText);
    if (!p.ok) return p;
    if (!token || p.token !== token) throw new Error('プレビュー後に内容・資料が変わりました。もう一度確認してください。');
    var conflicts = p.changes.filter(function(ch) { return ch.conflict; });
    if (overwrite.some(function(k) { return !conflicts.some(function(ch) { return k === ch.instance_id + '/' + ch.field; }); })) throw new Error('未確認の修正対象です。');
    if (conflicts.some(function(ch) { return !overwrite.includes(ch.instance_id + '/' + ch.field); })) throw new Error('手修正した欄があります。保持する内容をAIの回答へ戻すか、欄ごとに上書きを選んでください。');
    astSavePending_(pending);
    var planHash = astHash_(SlideCore.canonical(p.plan)), made = [], backups = [], cleanupStarted = false;
    try {
      if (p.mode === 'create') {
        p.plan.slides.forEach(function(s) {
          var source = p.entries.find(function(e) { return e.state.template_id === s.template_id; });
          var slide = source.slide.duplicate(); made.push(slide);
          slide.move(SlidesApp.getActivePresentation().getSlides().length - 1);
          var spec = c.manifest.templates.find(function(t) { return t.id === s.template_id; });
          var bindings = astBindings_(slide, spec), fixed = astSignature_(slide, bindings), hashes = {};
          if (fixed !== source.state.fixed_hash) throw new Error('複製で固定部分が変わりました。');
          Object.keys(bindings).forEach(function(k) {
            var value = Object.prototype.hasOwnProperty.call(s.fields, k) ? s.fields[k] : '';
            astResolve_(slide, bindings[k]).range.setText(value); hashes[k] = astHash_(value);
          });
          if (fixed !== astSignature_(slide, bindings)) throw new Error('反映で固定部分・書式が変わりました。');
          astSave_(slide, { schema_version: '1', kind: 'deck', pack: c.pack, instance_id: s.instance_id,
            template_id: s.template_id, bindings: bindings, fixed_hash: fixed, baseline_hashes: hashes,
            request_id: requestId, plan_hash: planHash, phase: 'rendered', working_presentation_id: SlidesApp.getActivePresentation().getId() });
        });
        cleanupStarted = true;
        p.entries.forEach(function(e) { e.slide.remove(); });
        made.forEach(function(slide) { var state = astState_(slide); state.phase = 'complete'; astSave_(slide, state); });
      } else {
        p.entries.forEach(function(e) {
          backups.push({ slide: e.slide, notes: astNotes_(e.slide).asString(), values: Object.fromEntries(Object.keys(e.state.bindings).map(function(k) { return [k, astText_(astResolve_(e.slide, e.state.bindings[k]).range)]; })), bindings: e.state.bindings });
        });
        p.plan.slides.forEach(function(s, i) {
          var e = p.entries[i], state = e.state;
          state.phase = 'updating'; astSave_(e.slide, state);
          Object.keys(s.fields).forEach(function(k) {
            astResolve_(e.slide, state.bindings[k]).range.setText(s.fields[k]);
            state.baseline_hashes[k] = astHash_(s.fields[k]);
          });
          if (state.fixed_hash !== astSignature_(e.slide, state.bindings)) throw new Error('更新で固定部分・書式が変わりました。');
          state.phase = 'complete'; state.request_id = requestId; state.plan_hash = planHash;
          state.working_presentation_id = SlidesApp.getActivePresentation().getId(); astSave_(e.slide, state);
        });
      }
    } catch (error) {
      if (!cleanupStarted) {
        made.forEach(function(slide) { slide.remove(); });
        backups.forEach(function(b) {
          Object.keys(b.values).forEach(function(k) { astResolve_(b.slide, b.bindings[k]).range.setText(b.values[k]); });
          astNotes_(b.slide).setText(b.notes);
        });
      }
      throw new Error(cleanupStarted ? '生成ページは保持しました。整理が未完了です。同じ回答・実行IDで再試行してください。' : '反映に失敗しました。作業コピーを確認してください。');
    }
    return astFinish_(requestId, { ok: true, reused: false, pages: p.plan.slides.length, questions: p.plan.questions });
  } finally { lock.releaseLock(); }
}
