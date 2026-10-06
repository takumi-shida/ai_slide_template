/** Read-only diagnostics. No remote calls, slide edits, or property writes. */
function inspectCurrentPresentation() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('別の処理が実行中です。終了後に確認してください。');
  try {
    var result = { schema_version: '1', ok: true, mode: 'unknown', draft: true, pages: [], checks: [],
      limits: ['描画・文字の収まり・根拠の正しさは別途確認してください。', 'この診断は資料・ノート・保存記録を変更しません。'] };
    function check(code, ok, message, page) {
      var item = { code: code, ok: ok, message: message };
      if (page !== undefined) item.page_number = page;
      result.checks.push(item); if (!ok) result.ok = false;
    }
    var c;
    try { c = astCatalog_(); result.draft = !c.release; check('catalog', true, 'テンプレートの仕様・版を読み取りました。'); }
    catch (_) { check('catalog', false, '設定を読めません。生成したCore・Catalogと設置ファイルを担当者が確認してください。'); return result; }
    var slides;
    try { slides = SlidesApp.getActivePresentation().getSlides(); }
    catch (_) { check('presentation', false, '資料を読めません。Google Slides形式・設置先・実行権限を確認してください。'); return result; }
    var kinds = [], unregistered = 0;
    slides.forEach(function(slide, i) {
      var page = i + 1, state;
      try { state = astState_(slide); }
      catch (_) { check('state', false, 'ノートの記録を読めません。版違い・破損・ノートの変更を確認してください。', page); return; }
      if (!state) {
        unregistered++;
        var spec = c.manifest.templates.find(function(t) { return t.slide_index === i; });
        try {
          if (!spec) throw new Error('No source page');
          var bindings = astBindings_(slide, spec); astSignature_(slide, bindings);
          result.pages.push({ page_number: page, state: 'unregistered', fields: Object.keys(bindings).length });
          check('unregistered_tags', true, 'タグと取得可能な固定部分を読み取りました。未登録の原本候補です。', page);
        } catch (_) { check('unregistered_tags', false, 'タグ・書式を読めません。未加工の原本コピーと仕様のページ順を確認してください。', page); }
        return;
      }
      kinds.push(state.kind);
      result.pages.push({ page_number: page, state: state.kind, phase: ['rendered', 'updating', 'complete'].includes(state.phase) ? state.phase : null, fields: Object.keys(state.bindings).length });
      try {
        var spec = c.manifest.templates.find(function(t) { return t.id === state.template_id; });
        if (!spec || SlideCore.canonical(Object.keys(state.bindings).sort()) !== SlideCore.canonical(Object.keys(spec.fields).sort())) throw new Error('Binding mismatch');
        Object.keys(state.bindings).forEach(function(k) { astResolve_(slide, state.bindings[k]); });
        if (state.kind === 'template') astBindings_(slide, spec);
        check('bindings', true, '登録した欄を読み取りました。', page);
      } catch (_) { check('bindings', false, '登録した欄が仕様と一致しません。タグ・表セル・対象要素の変更を確認してください。', page); }
      try { check('fixed', state.fixed_hash === astSignature_(slide, state.bindings), '固定部分・配置・取得可能な文字書式の登録時比較です。', page); }
      catch (_) { check('fixed', false, '固定部分を読み取れません。対応範囲とGoogle APIの動作を確認してください。', page); }
      if (state.kind === 'template') {
        var expected = c.manifest.templates.find(function(t) { return t.slide_index === i; });
        check('template_order', !!expected && state.template_id === expected.id, '原本仕様のページ順・用途と比較しました。', page);
      }
      if (state.kind === 'deck') {
        check('phase', state.phase === 'complete', '反映が完了した状態か確認しました。', page);
        check('baselines', !!state.baseline_hashes && Object.keys(state.bindings).every(function(k) { return /^[a-f0-9]{64}$/.test(state.baseline_hashes[k] || ''); }), '手修正判定の基準記録が揃っているか確認しました。', page);
      }
    });
    if (!slides.length) check('pages', false, 'ページがありません。');
    else if (unregistered === slides.length && result.ok) result.mode = 'unregistered-template';
    else if (kinds.length === slides.length && kinds.every(function(k) { return k === 'template'; })) result.mode = 'template';
    else if (kinds.length === slides.length && kinds.every(function(k) { return k === 'deck'; })) result.mode = 'deck';
    else { result.mode = 'mixed-or-unreadable'; check('composition', false, '未登録・生成・原本の混在、または読めないページがあります。'); }
    if (['template', 'unregistered-template'].includes(result.mode)) check('template_pages', slides.length === c.manifest.templates.length, '原本仕様のページ数と比較しました。');
    try {
      var saved = astPending_(); result.pending = !!saved;
      check('recovery', true, saved ? '前回の記録があります。同じ利用者でサイドバーを開き、確認して再試行してください。' : 'この利用者の保留記録はありません。');
    } catch (_) { check('recovery', false, '前回の保存記録を読めません。担当者が確認するまで新しい反映を止めてください。'); }
    return result;
  } finally { lock.releaseLock(); }
}
function showTemplateDiagnostics() {
  var report = inspectCurrentPresentation();
  var text = JSON.stringify(report, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = '<!doctype html><html lang="ja"><meta charset="utf-8"><body style="font:14px/1.6 system-ui;padding:16px">' +
    '<p>設定・記録の読み取り診断です。合格でも描画品質は別途確認してください。</p>' +
    '<label for="report">診断結果（この資料の担当者へ共有できます）</label>' +
    '<textarea id="report" readonly style="width:100%;height:340px">' + text + '</textarea></body></html>';
  SlidesApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(600).setHeight(480), '設定・状態を確認');
}
