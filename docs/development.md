# 開発環境

## 起動

```sh
npm install
npm run dev      # 開発サーバー（http://localhost:5173）
npm run build    # 型チェック + 本番ビルド
npm run lint     # oxlint
```

スマホ実機で確認するときは `npm run dev -- --host` で起動し、同じ Wi-Fi から PC の IP アドレスにアクセスする。

## データ接続の切り替え

既定は従来のモックです。`VITE_DATA_BACKEND=firebase` でFirestore版を選択できます。Firebaseアカウントの扱い、`.env.local` の設定、エミュレータ起動とルールテストは [Firebase接続ガイド](firebase.md) を参照してください。実プロジェクトへのルール適用前はエミュレータで検証します。

## モックモード

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
