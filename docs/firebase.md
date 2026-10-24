# Firebase / Firestore の接続と検証

## 管理アカウントを安全に使う

Googleアカウントのパスワード、CLIトークン、サービスアカウントJSONをチャットやリポジトリで渡す必要はありません。
FirestoreはFirebaseプロジェクト内のデータベースです。Firestore専用アカウントはありません。

- 管理コンソールや将来のデプロイに使うGoogleアカウントは、開発PCのターミナルで `npx firebase login:add` を実行し、開いたブラウザ上で本人が選択・ログインします。
- 複数アカウントのときは `npx firebase login:list` で確認します。必要な操作をするときは `--account` と `--project` を明示して取り違えを防ぎます。
- 共有するのはプロジェクトIDとWebアプリのFirebase設定です。Web用の設定値は公開前提の識別情報ですが、このプロジェクトでは `.env.local` に置きます。
- アプリ利用者のEmail/Password認証と、上記の管理Googleアカウントは別です。利用者はアプリ画面から登録します。
- 本PRの検証に実アカウント・本番認証情報は不要です。エミュレータは仮のユーザーで動作します。

## ログイン不要のエミュレータ

Node.js 22.12以上（CIは24）とJava 21以上を用意します。

```sh
npm ci
npm test
```

`npm test` はAuthとFirestoreのエミュレータを起動し、ルール・SDKリポジトリを検証して停止します。
プロジェクトIDは実在しない `demo-bukatsu` 固定です。実プロジェクトへ接続しません。

画面を確認するときは、別ターミナルで次を実行します。

```sh
npm run emulators
```

`.env.local` に以下を設定し、`npm run dev` を起動します。

```dotenv
VITE_DATA_BACKEND=firebase
VITE_USE_EMULATOR=true
```

エミュレータ使用時のプロジェクト ID は `demo-bukatsu` に固定されます（`src/data/firebase/app.ts`）。

モックのサンプルユーザーはFirebase側には存在しません。画面で架空のメールアドレスを使って新規登録し、チームを作成します。
複数アカウントを試す場合は別ブラウザ／別プロファイルを使用します。同じブラウザ内はAuthのログイン状態が同期されます。
エミュレータは初回にランタイムをダウンロードします。`npm run emulators` は停止時にデータを `.emulator-data/` へ保存し、次回の起動時に読み込みます（`npm test` は保存しません）。

## 作成済みプロジェクトの接続準備

1. Firebaseコンソールで、対象のプロジェクトIDとSparkプランを確認します。本番のプロジェクト ID は `bukatsu20261024`（`docs/development.md` を参照）。
2. Webアプリを登録し、「プロジェクトの設定 → マイアプリ → SDKの設定」から設定値を確認します。
3. Authenticationで「メール／パスワード」を有効にします。実機で使用するドメインを承認済みドメインへ追加します。
4. Cloud Firestore Standard editionのデフォルトデータベースを用意します。公開のテストモードは使わず、このPRのルールで制限します。
5. `.env.example` を参考に `.env.local` に値を設定します。`VITE_DATA_BACKEND=firebase`、実環境では `VITE_USE_EMULATOR=false` とします。

コレクションは、チーム作成・参加・予定作成などの書き込み時に作成されます。コンソールで空のコレクションを事前作成する必要はありません。
`firestore.indexes.json` は追加の複合インデックスなしです。現在の予定一覧は `startAt` の単一フィールドインデックスで動作します。

初回の接続実装時点では、実プロジェクトの設定変更・ルール公開・Hosting 公開は実行していません。
現在の公開状況は末尾の Issue #12 の記録を参照してください。ルール適用前の実環境でアプリを使わないでください。

## 切り替えとエラー

- 未設定または `VITE_DATA_BACKEND=mock` は従来のモックです。
- `VITE_DATA_BACKEND=firebase` はFirebase AuthとFirestoreを使用します。エラー時にモックへ黙って切り替わりません。
- 設定不足は起動画面で通知し、購読失敗はトーストと再取得導線で通知します。
- 実環境ではAuthのログイン永続化と、Firestoreの複数タブ対応IndexedDBキャッシュを使用します（`src/data/firebase/app.ts`）。共有端末ではログアウトしてください。エミュレータ使用時のキャッシュはメモリのみです。
- エミュレータ使用時はAuthとFirestoreの**両方**をローカルへ接続します。
- 日付の境界は端末のローカル時刻です。午前0時、画面復帰、再取得で予定クエリを張り直します。一定間隔のポーリングはしません。

## 追加の整合性フィールド

- `teams/{teamId}.adminUid`: 現在の管理者のうち1人を指します。そのメンバーが書き込み後も管理者として存在することをルールで確認します。管理者の解除・削除時は必要に応じて別の管理者へ同時に付け替えるため、並行操作でも管理者が0人になりません。
- `members/{uid}.heldCount` / `equipmentChangeId`: 用具の取得・手放し・削除に対応したカウンターです。同じトランザクションで対象用具と更新する必要があります。1人100点を上限とします。
- `equipment/{id}.nameKey` / `equipmentNames/{nameKey}.itemId`: 名前の予約インデックスです。用具と同じ書き込みで作成・削除します。SDK側はNFKC正規化し、ルールは小文字化・空白除去したキーとの一致を検証します。ルール言語にはNFKC変換がないため、改変クライアントからのUnicode互換文字すべての同一性までは保証しません。用具名の `/` と予約IDは使用できません。

ルールからコレクション全体の件数・用具の一覧を検査することはできません。このため退会・登録削除は用具を1点ずつ解放したあと、`heldCount == 0` を条件に、メンバーの削除とプロフィールの所属解除を同じトランザクションで行います。途中失敗では解放済み用具だけが手元から離れ、所属は維持されます。再実行できます。

予定削除は親の予定を先に削除し、新しいメモ作成を禁止してから、メモを450件ずつ削除します。途中失敗時は予定は一覧から消え、残ったメモは予定編集者のみが後片付け用に読めます。同じ `events.remove` を再実行すると削除を再開できます。管理者に他人のメモ単体削除権限を与えることはありません。

## 検証コマンド

```sh
npm run lint
npm run typecheck:tests
npm run build
VITE_DATA_BACKEND=firebase VITE_USE_EMULATOR=true npm run build
npm test
```

CIはログイン・秘密情報なしで同じ検証を行います。本番プロジェクトの権限設定やiPhone Safari／LINE内ブラウザの実機動作は別途確認が必要です。

表示名変更は、取得済みの所持用具一覧とメンバーの所持数が一致することをトランザクションで確認し、用具の取得・手放しと競合した場合は一覧を読み直します。プロフィール・メンバー・所持用具の表示名が部分的に更新されることを防ぎます。

## Firebase Hosting への公開（Issue #12）

公開先は `https://bukatsu20261024.web.app`。Firebase Hosting で Vite の `dist/` のみ配信し、Spark プランのまま使用する。
設定は [Firebase Hosting の公式ガイド](https://firebase.google.com/docs/hosting/full-config) に従う。
HTML は再検証し、ハッシュ付きの `/assets/` は長期キャッシュする。SPA の URL は `index.html` に書き戻す。

1. `git fetch origin` 後、公開する `origin/main` のコミットを確認する。作業ブランチは `origin/dev` から作る。main と作業ブランチのアプリコードに差がある場合、main の別 worktree でビルドするなど、公開対象が混ざらないようにする。
2. `npm ci` を実行する（Node.js 24 推奨）。Firebase CLI に対象プロジェクトの権限があるアカウントでログインする。
3. `.env.local` に本番の Firebase Web 設定を用意し、`VITE_FIREBASE_PROJECT_ID=bukatsu20261024` であることを確認する。設定値や CLI 認証情報はコミットしない。
4. `npm run lint` と `npm run build:hosting` を実行する。公開ビルドでは `VITE_DATA_BACKEND=firebase`、`VITE_USE_EMULATOR=false` を明示するため、開発用 `.env.local` のモック／エミュレータ設定に影響されない。
5. Authentication の承認済みドメインに `bukatsu20261024.web.app` が含まれ、Firestore ルールが公開する main と一致していることを確認する。Hosting のコマンドはルールを公開しない。ルールの更新が必要なら、エミュレータで検証したうえで別途対象を明示して反映する。
6. `npm run deploy:hosting` を実行する。`--only hosting --project prod` に限定し、predeploy で毎回ビルドする。公開した main のコミットを残す場合は `npm run deploy:hosting -- --message "Issue #12: main <コミットSHA>"` とする。
7. 公開 URL と共有 URL `https://bukatsu20261024.web.app/?openExternalBrowser=1` の表示、JS/CSS の配信、キャッシュヘッダーを確認する。

### 公開後の実機確認

以下は iPhone 実機で確認する。HTTP の疎通確認や PC の確認だけでは完了扱いにしない。

- [ ] Safari：新規登録／ログイン、再度開いた際のログイン維持、チーム作成／参加、予定・出欠、用具、設定、画面内の再取得。
- [ ] LINE：共有リンクの `?openExternalBrowser=1` で外部ブラウザが開くこと。LINE 内ブラウザで開いた場合もメール／パスワードでログインし、主要操作と再取得を確認する。
- [ ] ショートカット／ホーム画面：共有 URL を開き、起動・ログイン・再起動後の状態を確認する。保存領域が Safari や LINE と別の場合は個別にログインする。
- [ ] 別端末／別ブラウザ：出欠・用具の変更、バックグラウンドからの復帰、再取得が反映されること。

実機確認を終えるまでは Issue #12 の実機確認項目を未完了のままにする。

### 公開記録（2026-10-24）

- 対象：`origin/main` の `77b467cb279619e14dc1cc1b4fba9d1aa636ba4f`。作業開始時の `origin/dev` も同じコミット。アプリ・依存ロック・Firestore ルールは main から変更していない。
- Hosting：`npm run deploy:hosting` で公開済み。本番の Firebase 接続でビルドし、エミュレータには接続しない。
- 配信確認：公開された全8ファイルがローカルの `dist/` とバイト単位で一致し、HTTP 200 を返す。共有 URL・SPA パスは `index.html` と一致。HTML の再検証とハッシュ付きアセットの長期キャッシュも確認済み。
- 検証：lint、テストの型チェック、本番ビルド、既存テスト60件が成功。既存の開発エミュレータが使用中だったため、テストは一時コピーで接続先ポートのみ変更し、専用エミュレータ（Auth 19099／Firestore 18080）で実施した。
- Authentication：`bukatsu20261024.web.app` は承認済みドメインに含まれる。
- **未完了：本番 Firestore はまだ全読み書きを拒否する初期ルール。** main のルール反映は自動承認レビューで「Hosting の依頼ではアクセス権限の変更まで承認されていない」と拒否され、実施していない。データを使う機能の利用には明示的な承認後のルール反映が必要。検証後に実行するコマンドは `npx firebase deploy --only firestore:rules --project prod`。
- iPhone Safari・LINE 内ブラウザ・ショートカット経由の実機操作は未確認。
