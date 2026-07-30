# 五行バランスチェック(東洋アプリ) — PROJECT.md

> このファイルは Claude Code / ChatGPT / その他AIが同じ認識で開発を進めるための設計書。
> 更新日: 2026-07-25。変更したAIは必ずこのファイルも更新すること。

## 1. このアプリの目的

東洋医学(五行・相生相克)の考え方で、症状部位から根本原因の候補(五臓六腑)をたどり、感情・食養生・生活習慣のセルフケア提案につなげるWebアプリ。

- 「診断」とは言わない。**「バランスチェック」表記で統一**(医療行為ではない)
- 免責を常時表示。受診勧奨(レッドフラグ)は隠さない
- 症状チェックは**ルールベース**(LLM診断は使わない。理由: 再現性・監修可能性・安全性)
- 収益設計: 広告枠(A枠3,000円/B枠8,000円) + 楽天/Amazonアフィリエイト(ID取得待ち) → docs/広告掲載ガイドライン.md

## 2. 公開環境

| 項目 | 値 |
|---|---|
| 本番URL | https://gogyo-balance-check.netlify.app |
| ホスティング | Netlify(site ID: 7ef3d2c6-01f6-4e45-8409-527655153bfc / goodvibes.nd@gmail.com) |
| 村バックエンド | Cloudflare Workers + Durable Objects → https://gogyo-village.gas-teki-nd.workers.dev |
| 解析 | Cloudflare Web Analytics(Cookieレス) |
| デプロイ規律 | **まとめて最小回数**(Netlifyはクレジット制。過去に枯渇事故あり) |

デプロイ手順: index.html + css + js + data のみを配信ディレクトリへrsync(docs・参考素材は非公開) → `npx netlify-cli deploy --prod`。JS/CSS更新時は `?v=0XX` キャッシュバスターを必ず上げる。

## 3. 機能一覧(実装済み)

### Phase 1: 症状チェック(コア)
- フロー: 部位(11) → 症状(45) → 詳細絞り込み(左右/場所/指=経絡) → 問診7問 → 結果(13証パターン)
- 結果画面: 根本原因の臓腑ペアが人体図で発光、感情・栄養素・ハーブティー・香り・ツボ(つながり説明つき)
- 問診は候補限定の重みづけ(候補外パターンが選ばれない安全設計)
- redFlags常時表示、耳・腰の一部症状は受診勧奨
- シェア/結果保存(localStorage)/問い合わせ・広告応募(Netlify Forms)

### 人体ビジュアル
- 2.5D: `js/figure.js` ホログラム風人体(ドラッグ回転・タップズーム)
- 3D: `js/viewer3d.js` Three.js + GLB(血管/骨格/素体、CC-BY要クレジット)、フレネル発光シェーダー
- 学習モード「からだを知る」: 内臓(子午流注)/骨格/血管/経絡ツボ/チャクラのレイヤー切替 + 部位図鑑

### Phase 2: 四柱推命「精霊」
- `js/shichusuimei.js` 命式計算(日柱=JDN+49式・節入り略算・五虎遁/五鼠遁・蔵干重みつき五行集計・都道府県経度補正)
- 50タイプの精霊キャラ(日干10 × 傾向5)、金ネオンUIの結果画面、保存/シェア

### Phase 3: 五行の村(コミュニティ・自前チャット)
- Cloudflare Workers + Durable Objects(`server/village-worker/`)
- VillageRegistry(村一覧/申請/承認/通報/presence 6h) + VillageRoom(WebSocket Hibernation + SQLite)
- 村作成は申請→村長承認制。レート制限(2秒/15分)・NGワード・URL禁止・BAN・通報
- LINE風UI: トーク/村をさがす/フレンド、全画面チャット(#room/idディープリンク)、画像送信(R2)、住民証ジェネレーター(canvas PNG)、引継ぎコード(GOGYO1.+base64)
- XSS対策: チャット描画はtextContentのみ

### 写真歪みチェック(β)
- `js/posture.js` + MediaPipe(ローカルvendor、wasm18MB+モデル)。肩/骨盤/頭・顔の傾き検出
- **完全端末内処理。写真は非送信・非保存**(プライバシー原則)

## 4. データ設計(DBではなくファイルベース + DO SQLite)

| ファイル | 内容 |
|---|---|
| `data/mapping.json` | 診断コア: 13証パターン・11部位・45症状(v0.2.0-draft) |
| `data/spirits.json` | 四柱推命50タイプ(プロフィール・五行文) |
| `data/learn.json` | 学習モード(臓腑・経絡・ツボ・チャクラ) |
| `data/ads.json` | 広告枠(現在ハウス広告=スポンサー募集) |
| `data/products.json` | アフィリエイト商品(ID取得待ち) |
| localStorage | 結果保存 `gogyo_saved_results_v1` / 村参加 `gogyo_joined_v1` / フレンド `gogyo_friends_v1` |
| 村サーバー | Durable Objects SQLite(チャット・BAN・申請)+ R2(画像 gogyo-village-images) |

**重要な整合ルール**: `data/mapping.json` と `docs/対応表ドラフト_v0.1.md` は1対1整合が必須。監修者はdocsを見て修正し、JSONへ反映するフロー。片方だけ変えてはいけない。

## 5. AIプロンプト

このアプリは**実行時にLLMを使わない**(症状チェックはルールベース、四柱推命は計算式)。
AIの役割は開発時のみ: 対応表ドラフトの草案作成 → **専門家監修が必須**(未完了。最重要の残タスク)。

## 6. デザイン思想

- ダークネオン + ホログラム風(参考イラスト起点)。タブごとにアクセント色(症状=赤系/精霊=金/村=緑)
- 東洋思想の世界観を「怪しくなく、現代的に」見せる。コントラストAA対応
- 医療との距離感: 断定しない・受診の入口をふさがない・端末内処理でプライバシーを守る
- フォント/UIは既存のトーンを踏襲すること(勝手に明るいテーマへ変えない)

## 7. 今後実装予定(優先順)

1. **対応表の専門家監修**(→ mapping.json反映) — 信頼性の核
2. 楽天/Amazonアフィリエイト組み込み(ID取得後。楽天は新方式API)
3. 村の運営機能拡充(必要になったら)
4. Netlifyクレジット逼迫時: Cloudflare Pages移行 or 50MB→10MB軽量化(GLB圧縮/モデル外部化)

## 8. 技術構成・約束事

- Vanilla JS・ビルドなし。ESモジュール(figure/viewer3d/posture)とclassic scriptの橋渡しは`window.__xxx`
- Three.js / MediaPipe はローカルvendor(`js/vendor/`)。CDN依存しない
- GLBモデルはCC-BY(クレジット表記必須)
- 更新時は `?v=0XX` キャッシュバスターを上げる(現在v090)
- `server/village-worker/.dev.vars` は秘密(ADMIN_KEY)。**コミット禁止**
- 参考素材(五行キャラ参考/人体参考イラスト/精霊シート 計300MB)はgit管理外(ローカルのみ)
