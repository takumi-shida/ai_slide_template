/** Bound-script storage only. No model, network request, or additional OAuth scope. */
var AST_PENDING_KEY = 'ai-slide-template.pending.v1';
var AST_PENDING_CHUNK = AST_PENDING_KEY + '.chunk.';
var AST_PENDING_LIMIT = 200000;
function astAscii_(value) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, function(c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
}
function astPending_() {
  var store = PropertiesService.getUserProperties(), header = store.getProperty(AST_PENDING_KEY);
  if (!header) return null;
  var record;
  try { record = JSON.parse(header); } catch (_) { throw new Error('前回の実行記録が破損しています。担当者に確認してください。'); }
  if (!record || record.schema_version !== '1' || !Number.isInteger(record.chunks) || record.chunks < 1 || record.chunks > 29 || !/^[a-zA-Z0-9_-]{8,100}$/.test(record.id || '') || !/^[a-f0-9]{64}$/.test(record.hash || '')) throw new Error('前回の実行記録の形式が不正です。');
  if (record.presentation_id !== SlidesApp.getActivePresentation().getId() || SlideCore.canonical(record.pack) !== SlideCore.canonical(astCatalog_().pack)) throw new Error('前回の実行記録と資料・版が一致しません。担当者に確認してください。');
  var text = '';
  for (var i = 0; i < record.chunks; i++) {
    var part = store.getProperty(AST_PENDING_CHUNK + record.id + '.' + i);
    if (part === null || part.length > 7000) throw new Error('前回の実行記録が欠けています。');
    text += part;
  }
  if (text.length > AST_PENDING_LIMIT || astHash_(text) !== record.hash) throw new Error('前回の実行内容が変更されています。');
  var pending;
  try { pending = JSON.parse(text); } catch (_) { throw new Error('前回の実行内容が読めません。'); }
  if (!pending || pending.id !== record.id || typeof pending.text !== 'string' || typeof pending.sourceText !== 'string' || typeof pending.token !== 'string' || !Array.isArray(pending.overwrite) || !pending.overwrite.every(function(k) { return typeof k === 'string'; })) throw new Error('前回の実行内容の形式が不正です。');
  var parsed = SlideCore.parsePlan(pending.text), checked = parsed.ok ? SlideCore.validatePlan(parsed.value, astCatalog_(), astSources_(pending.sourceText)) : parsed;
  if (!checked.ok) throw new Error('保存した回答が現在の仕様に適合しません。');
  return { record: record, pending: pending };
}
function astDeleteChunks_(store) {
  Object.keys(store.getProperties()).filter(function(key) { return key.indexOf(AST_PENDING_CHUNK) === 0; }).forEach(function(key) { store.deleteProperty(key); });
}
function astSavePending_(pending) {
  var old = astPending_(), text = astAscii_(pending);
  if (old) {
    if (old.pending.id !== pending.id || astAscii_(old.pending) !== text) throw new Error('前回の反映が未確認です。同じ実行を再試行するか、記録を解除して確認し直してください。');
    return;
  }
  if (text.length > AST_PENDING_LIMIT) throw new Error('回答が再試行用の保存容量を超えています。資料を分けてください。まだ反映していません。');
  var store = PropertiesService.getUserProperties(), chunks = {};
  astDeleteChunks_(store);
  var count = Math.ceil(text.length / 7000);
  for (var i = 0; i < count; i++) chunks[AST_PENDING_CHUNK + pending.id + '.' + i] = text.slice(i * 7000, (i + 1) * 7000);
  // Write the commit marker last. Incomplete chunks never authorize slide changes.
  store.setProperties(chunks, false);
  store.setProperty(AST_PENDING_KEY, JSON.stringify({ schema_version: '1', id: pending.id,
    presentation_id: SlidesApp.getActivePresentation().getId(), pack: astCatalog_().pack,
    chunks: count, hash: astHash_(text), created_at: new Date().toISOString() }));
  var saved = astPending_();
  if (!saved || astAscii_(saved.pending) !== text) throw new Error('再試行用の記録を保存できません。まだ反映していません。');
}
function astClearPending_(requestId) {
  var store = PropertiesService.getUserProperties(), header = store.getProperty(AST_PENDING_KEY);
  if (header && JSON.parse(header).id !== requestId) throw new Error('別の実行記録は削除できません。');
  // Delete the marker first: a cleanup interruption cannot expose partial payloads.
  store.deleteProperty(AST_PENDING_KEY);
  astDeleteChunks_(store);
}
function astFinish_(requestId, result) {
  // Flush the document before deleting its recovery record.
  SlidesApp.getActivePresentation().saveAndClose();
  try { astClearPending_(requestId); }
  catch (_) { result.warnings = ['資料は保存しました。実行記録の整理に失敗しました。開き直して同じ実行を確認してください。']; }
  return result;
}
function getPendingRequest() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。終了後に開き直してください。');
  try {
    var saved = astPending_();
    if (!saved) return { ok: true, pending: null };
    var plan = SlideCore.parsePlan(saved.pending.text).value, c = astCatalog_(), changes = [];
    plan.slides.forEach(function(s, i) {
      var spec = c.manifest.templates.find(function(t) { return t.id === s.template_id; });
      Object.keys(s.fields).forEach(function(key) { changes.push({ instance_id: s.instance_id, field: key,
        page_number: i + 1, label: spec.fields[key].label, proposed: s.fields[key], conflict: false }); });
    });
    return { ok: true, pending: saved.pending, preview: { mode: 'retry', draft: !c.release,
      changes: changes, questions: plan.questions, warnings: ['前回確認した内容です。現在の資料を確認してから再試行してください。'] } };
  }
  finally { lock.releaseLock(); }
}
function clearPendingRequest(requestId) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。');
  try {
    var saved = astPending_();
    if (!saved) return { ok: true };
    if (saved.pending.id !== requestId) throw new Error('前回の実行記録が変わっています。');
    var states = SlidesApp.getActivePresentation().getSlides().map(astState_);
    if (!states.length || states.some(function(s) { return !s || (s.kind === 'deck' && s.phase !== 'complete'); }) || new Set(states.map(function(s) { return s.kind; })).size !== 1) throw new Error('資料の反映が未完了です。同じ実行を再試行するか、原本から作業コピーを作り直してください。');
    astClearPending_(requestId); return { ok: true };
  } finally { lock.releaseLock(); }
}
function prepareDistributionCopy() {
  var ui = SlidesApp.getUi();
  if (ui.alert('配布コピーのノート削除', '別コピーの更新用記録と、すべての発表者ノートを削除します。このコピーは更新に使えなくなります。削除してよいですか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return { ok: true, cancelled: true };
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。');
  try {
    var presentation = SlidesApp.getActivePresentation(), id = presentation.getId(), slides = presentation.getSlides();
    if (!slides.length) throw new Error('配布するページがありません。');
    var saved = astPending_();
    if (saved) throw new Error('前回の実行が未確認です。先に再試行・確認してください。');
    var notes = slides.map(function(slide) {
      var s = astState_(slide);
      if (!s || s.kind !== 'deck' || s.phase !== 'complete' || typeof s.working_presentation_id !== 'string') throw new Error('完了した資料の別コピーで実行してください。以前の版の資料は先に作業コピーで更新してください。');
      if (s.working_presentation_id === id) throw new Error('元の作業資料ではノートを削除できません。Slidesの「コピーを作成」で別コピーを作ってください。');
      return { slide: slide, text: astText_(astNotes_(slide)) };
    });
    try { notes.forEach(function(n) { astNotes_(n.slide).clear(); }); }
    catch (_) {
      notes.forEach(function(n) { astNotes_(n.slide).setText(n.text); });
      throw new Error('ノートの削除に失敗しました。配布コピーを確認してください。');
    }
    presentation.saveAndClose();
    ui.alert('ノートを削除しました。本文・埋め込み情報・共有権限と、紐づくスクリプトの扱いを確認してから配布してください。');
    return { ok: true, pages: slides.length };
  } finally { lock.releaseLock(); }
}
