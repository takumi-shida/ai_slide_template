# AIホストと配布の対応状況

確認日: 2026-10-06。形式の対応と実機の動作確認を分けています。

| 環境 | 同梱するもの・経路 | 検証状況 |
| --- | --- | --- |
| Gemini Workspace Web | Slidesの指示コピーと回答貼り付け | サーバーとサイドバーの連携をモック試験。実Google未検証 |
| ChatGPT Web / Claude Web | 同じコピー経路 | ローカルへの自動アクセス無し。Webプラグインの導入試験は未実施 |
| ChatGPT Work / Codex | 標準 `plugin.json`、`skills/`、互換カタログ | Skillの構造検査と新しいエージェントによるCLI利用試験。ホストへの実インストールは未実施 |
| GitHub Copilot CLI | 標準マニフェスト、Claude互換カタログ、共通Skill＋CLI | Linux・1.0.92で登録、導入、有効化、2つのSkillの検出に成功。モデルによる呼び出しは未検証 |
| Claude Code | `.claude-plugin/plugin.json`、`skills/`、カタログ | Linux・2.1.291で厳格なマニフェスト検査、カタログ登録、2つのSkillの一覧取得に成功。導入は25秒でタイムアウトし、成功未確認 |
| その他Ponytailで扱うホスト | `adapters/instructions.md` と共通CLIを使う指示 | 対応候補。自動導入、各ホスト固有のプラグイン形式は未実装 |

## 共通する準備

READMEに従い、ユーザーが選んだローカルのチェックアウトで `npm ci` を実行します。Skillの実行環境からそのCLIとパックへアクセスできる必要があります。SkillのみのインストールではCLIのビルドや認証は実行されません。

エージェントにCLIの場所とパックの場所を明示してください。例えば「`/absolute/checkout/bin/ai-slide-template.js` をNodeで実行し、`/private/packs/company-v1` を使う」です。クラウド側の作業環境に会社PCのパックが自動で見えるとは想定しません。

生成した計画はCLIで検証し、v0.1ではSlidesサイドバーへ戻します。プラグインはSlides編集権限を付与せず、Google認証、MCP、画像作成、会社情報の取得を追加しません。

## 導入確認用の手順

ホストの管理ポリシーと `--help` を確認してから、自分の環境で試してください。以下でCopilotの登録・導入は検証済み、ClaudeとCodexの導入完了は未確認です。記載したバージョンは確認環境であり、最小対応バージョンを示しません。

プラグインのソースには、会社パックや生成した設定を置かないコード専用のチェックアウトを使ってください。Claudeの導入試験ではソース配下の `node_modules/` がキャッシュへコピーされました。Gitの除外設定を、プラグインのコピー対象の制御として扱いません。CLIをビルドする作業場所と、機密パックの保存先は別に指定できます。

Copilot CLIはローカルのカタログを登録し、プラグインを選びます。

```bash
copilot plugin marketplace add /absolute/checkout
copilot plugin install ai-slide-template@ai-slide-template
copilot plugin list
```

Claude Codeでは、認証やモデル呼び出しをせずにマニフェストとカタログを調べられます。この検査と一覧取得は実行済みですが、Skillの意味や実行結果の検証ではありません。

```bash
claude plugin validate /absolute/checkout/.claude-plugin/plugin.json --strict --json
claude plugin validate /absolute/checkout/.claude-plugin/marketplace.json --strict --json
claude plugin marketplace add /absolute/checkout
claude plugin details ai-slide-template@ai-slide-template
```

開発用のローカル読み込みは、未検証の導入候補です。

```bash
claude --plugin-dir /absolute/checkout
```

セッションで `/ai-slide-template:create-slides` または `/ai-slide-template:prepare-slide-template` の検出と呼び出しを確認します。

Codexでは公式のローカルカタログ追加経路を使い、ChatGPTデスクトップのPlugins画面でそのソースを選び、導入を確認します。

```bash
codex plugin marketplace add /absolute/checkout
codex plugin marketplace list
```

`.claude-plugin/marketplace.json` はOpenAI側の互換経路にも用意しています。ソースの可用性は画面・ホストで異なります。公開ディレクトリへの審査・公開は行っていません。Skillの前提無し利用試験は、これらのインストール成功を意味しません。

## 共通化するものとしないもの

ページ・欄・根拠・版の契約と検証器は共通です。AIの文章能力、ファイルアクセス、インストール形式、ログイン、権限のUI、編集ツールは各ホストの仕様に依存します。プラグインを経由しないGemini Webでも同じ契約を使えることを維持します。

今後MCPを追加する場合も、同じ検証器を使い、読み取り・計画・検証・反映を別の操作にします。ローカルの標準入出力サーバーだけではWebから使えるとは主張しません。個人SaaSを必要条件にせず、組織が選ぶホスティングと認証を検討します。

確認は個別の設定ディレクトリと、公開パッケージのCLIで行いました。利用者の既存設定・認証は変更せず、AIへの問い合わせは行っていません。Copilotは `COPILOT_HOME`、Claudeは `CLAUDE_CONFIG_DIR` を使いました。Windows、macOS、企業管理ポリシー下の動作は未検証です。

参考: [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)、[Claude Code plugins](https://code.claude.com/docs/en/plugins)、[Claudeのプラグイン検査](https://code.claude.com/docs/en/plugins-reference)、[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)。
