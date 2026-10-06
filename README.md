# ai_slide_template

既存資料のデザインを複製し、登録した文章欄だけをAIの提案で更新するOSSです。営業・企画・技術説明で、会社の承認済みレイアウトを再利用します。

**v0.1は試行用の初期実装です。** CLIと変更処理の自動テスト、Copilot CLIでのプラグイン導入を確認しています。実際のGoogle Slidesでの描画、会社の管理設定、各AIによるSkill実行は未検証です。「デザインを必ず再現できる」「作成時間が短縮した」とはまだ主張しません。

## 何を分担するか

| 担当 | 作業 |
| --- | --- |
| テンプレート担当者 | 原本を整理し、変更可能な欄・容量・用途を指定。変換後の表示を確認し、版を承認 |
| Gemini Web / ChatGPT / Claude / CLIエージェント | 目的と根拠に沿う構成、登録欄の文章、確認事項を提案 |
| ローカルCLI | PPTXの取り込み、仕様と根拠IDの検証、版管理、Slides用コードの生成 |
| Google Slidesのサイドバー | 差分を表示し、ページの複製と指定欄への反映を実行。手修正は既定で保持 |
| 資料の作成者 | 内容の正しさ、実際の文字の収まり、提出する資料を確認 |

AIに座標・フォント・任意コードを出させません。HTMLからPPTXへ変換する方式ではなく、変換後の既存Slidesページを複製します。根拠IDの存在確認と、記述が根拠に裏付けられるかの判断は別です。

## 動かす

Node.js 22.18以上（推奨24）とnpmを用意します。

```bash
git clone https://github.com/takumi-shida/ai_slide_template.git
cd ai_slide_template
# 初期版のPR #1が未マージの場合だけ、実装ブランチを選ぶ
git switch --track origin/codex/initial-template-mvp
npm ci
npm run check
npm run demo
```

デモは架空の3ページ（短文、2案比較、小さなネイティブ表）を `work/demo/` に作ります。実在企業の資料、APIキー、Google認証は不要です。同じ出力先を上書きしません。再実行時は `npm run demo -- work/demo-2` のように新しい出力先を指定してください。

```bash
node bin/ai-slide-template.js check --pack work/demo/pack
node bin/ai-slide-template.js validate --pack work/demo/pack --plan work/demo/plan.json --sources work/demo/sources.json
```

これはローカル検証までです。実際の資料の表示には[Google Slidesのセットアップ](docs/google-slides-setup.md)が必要です。デモを本番承認する処理はありません。

## 会社資料から作る

1. 許可された非公開の作業場所に原本のコピーを置き、過去顧客の文章・ノート・埋め込みデータ・外部リンクを整理します。固定のページ番号や案件名も確認してください。
2. PowerPoint等で、変更可能な図形全体・未結合の表セル全体を `{{title}}`、`{{body}}` のようなタグに置き換えます。欄内の文字書式は統一します。
3. `import` で非公開のパックを作り、`template.json` のページ用途、欄のラベル、必須条件、文字数、明示改行数を担当者が調整します。初期値は表示保証ではありません。
4. `build-google --draft` でテスト用コードを生成し、原本をGoogle Slidesへ変換したコピーに設置します。表示、表・グループ、長い日本語、復元、手修正、失敗時の挙動を確認します。
5. 表示の基準となるPDF等を保存し、担当者が検証結果を記録して `approve` します。承認後の原本・仕様変更は新しい版として扱います。
6. 承認済み原本のGoogle側コピーを管理・共有し、利用者は作業コピーで資料を作ります。日常の作成はテンプレート担当者のPCの稼働に依存しません。

```bash
node bin/ai-slide-template.js import --input /private/company-tagged.pptx --out /private/packs/company-v1 --id company
node bin/ai-slide-template.js build-google --pack /private/packs/company-v1 --out /private/google-draft --draft
# 実際の描画・復元試験を完了した担当者だけが実行
node bin/ai-slide-template.js approve --pack /private/packs/company-v1 --by '担当者名' --notes '確認した表示・復元試験と制限' --reference /private/rendered.pdf --attest-rendered-and-restored
node bin/ai-slide-template.js build-google --pack /private/packs/company-v1 --out /private/google-approved
```

パックには原本、仕様、検査結果、基準画像、承認記録をまとめます。原本と仕様のハッシュ、および基準画像のハッシュを検査します。承認記録は担当者の申告であり、外観の自動証明や改ざん防止署名ではありません。

会社の実物資料・パック・生成した `Catalog.gs` はこの公開リポジトリに入れないでください。`work/` と `private-packs/` はGitの対象外ですが、任意の保存先が自動で保護されるわけではありません。機密のパックは組織で許可された非公開ストレージでバックアップします。

## 利用するAI

GeminiはWorkspaceのWeb画面を使い、CLIやモデルAPIを前提にしません。Slidesサイドバーで指示をコピーし、Geminiへ貼り付け、回答をそのまま戻します。一般の利用者がJSONを手で編集する必要はありません。ChatGPT Web、Claude Webにも同じ経路を使えます。組織が許可した情報だけを、それぞれ許可されたAIへ渡してください。

CLIを使えるエージェント向けに、`create-slides` と `prepare-slide-template` の2つのSkill、標準 `plugin.json`、Claude互換のマニフェストを同梱します。これはPonytailを参考にした共通資産と薄いホスト対応の構成です。**プラグインを入れただけでCLIの依存関係がインストールされるわけではありません。** [対応状況](docs/compatibility.md)を確認してください。v0.1のエージェントは検証済みの計画まで作り、Slidesへの反映にはサイドバーを使います。

## 初期版の範囲

対応する可変要素は短文・箇条書き用の文字欄・未結合の表セルです。グループ内の文字欄も処理できますが、Googleへの変換結果の確認が必要です。グラフ・ロゴ・図形・図解は固定要素として複製し、データ更新や自由な組み替えは行いません。Google Slides原本はPPTXへ書き出して取り込めます。PDFだけの入力は手作業でテンプレート化します。

生成後の更新は同じページ数・順序・用途に限定します。構成を変えるときは原本から新しい作業コピーを作ります。SlidesからのPDF/PPTXの書き出しには標準のダウンロード機能を使い、それぞれの表示を確認します。完全オフラインのレンダリング、直接PPTX編集、MCP、SaaS、Workspace Studioはこの版の前提に含めません。

反映内容は再試行用に、紐づくスクリプトの利用者別保存領域へ一時保存します。サイドバーを開き直すと復元し、自動では再実行しません。成功後に記録を削除します。配布する場合はSlidesで別コピーを作り、「配布コピーのノートを削除」を実行できます。元の作業資料では実行できません。この機能は発表者ノート全体を削除し、本文・共有権限・紐づくスクリプトの扱いは別途確認します。

## 開発・検証

- [要件と実装の対応、次の開発順序](docs/requirements.md)
- [Google Slidesのセットアップ](docs/google-slides-setup.md)
- [プラグインと各AIの対応状況](docs/compatibility.md)
- [検証結果と自己レビュー](docs/verification.md)
- [貢献する](CONTRIBUTING.md)

共通契約と検証器は `src/core/`、ローカル入出力は `src/pack/` とCLI、Slides変更処理は `apps/slides-addon/` です。`npm run build` はNode用コード、Apps Script用の同じ検証器、JSON Schemaを生成します。MIT License。
