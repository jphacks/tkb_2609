# 開発環境

## 起動

```sh
npm install
npm run dev      # 開発サーバー（http://localhost:5173）
npm run build    # 型チェック + 本番ビルド
npm run lint     # oxlint
```

スマホ実機で確認するときは `npm run dev -- --host` で起動し、同じ Wi-Fi から PC の IP アドレスにアクセスする。

## Firebase

### 初回だけ

```sh
cp .env.example .env.local   # .env.local はコミットしない
```

- 開発中は `.env.local` の `VITE_USE_EMULATOR=true` のままにする。ローカルのエミュレータに接続し、本番のデータには一切触れない
- エミュレータには Java 11 以上が必要（`java -version` で確認）
- 本番の Firebase につなぐときだけ、`.env.local` に Firebase コンソールの設定値を入れて `VITE_USE_EMULATOR=false` にする

### エミュレータ（Auth・Firestore）

```sh
npm run emulators   # 別のターミナルで起動したままにする
```

| 用途 | URL |
| --- | --- |
| 管理画面（ユーザーやデータの確認・削除） | http://127.0.0.1:4000 |
| Authentication | 127.0.0.1:9099 |
| Firestore | 127.0.0.1:8080 |

- プロジェクト ID は `demo-bukatsu`。`demo-` で始まる ID は本番の Firebase につながらない
- 終了時（`Ctrl+C`）にデータを `.emulator-data/` に保存し、次回の起動時に読み込む。消したいときはこのフォルダを削除する
- 同じ Wi-Fi のスマホからも接続できるよう、エミュレータは `0.0.0.0` で待ち受ける。アプリは開いたホスト名（PC の IP アドレス）のエミュレータにつなぐ
- 初回起動時に Firestore エミュレータ（約 140MB）をダウンロードする。回線が不安定で失敗したら、もう一度起動する

### コードからの使い方

`src/data/firebase/app.ts` の `auth` と `db` を使う。エミュレータへの接続や設定値の読み込みはこのファイルで済ませてある。

### セキュリティルール

`firestore.rules`。Issue #7 で本実装するまでは、すべての読み書きを拒否する。

## 現在の状態：モック

データは `src/data/mock/` のメモリ上の実装で動いている（Firebase には未接続）。

- データとログイン状態は `localStorage` に保存されるので、リロードしても残る
- ログイン画面の「モック用アカウント」をタップすると入力される（パスワードは共通で `Bukatsu#2026`）

| アカウント | 状態 |
| --- | --- |
| `admin@example.com` | サンプルチームの管理者 |
| `member@example.com` | サンプルチームのメンバー |
| `newcomer@example.com` | チーム未所属（参加コード `K7MPX2QA` で参加できる） |

- 別のタブで別のアカウントにログインすると、変更がもう一方のタブにも反映される（リアルタイム更新の確認用）
- 設定タブ下部の「データを初期状態に戻す」でリセットできる

## ディレクトリ構成

```
src/
  types.ts              … ドメインの型（docs/data-model.md と対応）
  data/
    repository.ts       … データ読み書きのインターフェース
    firebase/app.ts     … Firebase の初期化（auth・db を提供、エミュレータ接続）
    mock/               … モック実装と初期データ
    index.ts            … 使う実装の切り替え（Firestore 版はここで差し替える）
  app/                  … 起動・ログイン振り分け・タブ・共通の Context
  components/           … 画面をまたいで使う部品（ヘッダー、シート、ダイアログ、アイコン）
  features/
    auth/               … ログイン・新規登録・チーム参加／作成
    schedule/           … 予定タブ
    equipment/          … 用具タブ
    settings/           … 設定タブ
  lib/                  … 表示や並び替えなどの小さな関数
```

## スタイル

- 共通のデザイントークン（色・角丸など）とボタン・入力欄は `src/index.css`
- 画面ごとのレイアウトは各ディレクトリの `*.module.css`（CSS Modules）
- 色は直接書かず、`index.css` の CSS 変数を使う
