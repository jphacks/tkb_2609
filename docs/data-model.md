# データ構造（Firestore）

すべてのチームデータは `teams/{teamId}` の下に置き、複数チームに対応できるようにする。

## コレクション

```
users/{uid}
  displayName: string
  teamIds: string[]                     … 所属チーム一覧
  teamId: string | null                  … 選択中のチーム
  membershipChangeTeamId: string         … 最後に所属変更した対象（所属変更時に保存）

joinCodes/{code}                       … 参加コード → チームの対応表
  teamId: string
  createdAt: Timestamp

teams/{teamId}
  name: string
  createdBy: uid
  createdAt: Timestamp
  adminUid: uid                       … 管理者が最低1人残ることを検証する参照先
  deletionUid?: uid                    … 削除開始者。存在すると新規参加・参加コード発行を停止（既存メンバーは通常どおり使える）
  settings:
    eventEditPolicy: "admins" | "all"
    eventTypes: [{ id: string, label: string, color: string }]

teams/{teamId}/private/joinCode        … 管理者だけが読める
  code: string

teams/{teamId}/members/{uid}
  displayName: string
  role: "admin" | "member"
  joinedAt: Timestamp
  joinCode: string                     … 参加時に使ったコード（ルールでの検証用）
  heldCount: number                    … 所持数（0〜100）
  equipmentChangeId: string             … 所持数の変更と対応する用具ID

teams/{teamId}/events/{eventId}
  title: string
  typeId: string                       … settings.eventTypes の id
  startAt: Timestamp                   … 日付と集合時間
  place: string | null
  deleting?: boolean                  … 予定削除の清掃中は true（一覧に表示しない）
  attendance: { [uid]: "absent" | "observe" | "late" | "leave_early" }
                                       … キーがない人は「出席」
  createdBy: uid
  updatedAt: Timestamp

teams/{teamId}/events/{eventId}/notes/{noteId}
  authorUid: uid
  authorName: string
  body: string
  createdAt: Timestamp

teams/{teamId}/equipment/{itemId}
  name: string                         … チーム内で重複不可
  nameKey: string                      … 小文字化・空白除去した予約キー
  holderUid: uid | null
  holderName: string | null            … 表示用にコピーして持つ
  updatedAt: Timestamp

teams/{teamId}/equipmentNames/{nameKey}
  itemId: string                       … 名前の予約先
```

### 設計上のポイント

- **出欠は予定のドキュメントの中にまとめて持つ。** 部員ごとに別ドキュメントにすると、一覧表示のたびに「人数 × 予定数」回の読み取りが発生し、無料枠を超える
- 「出席」は保存しない（キーを削除する）。未回答と出席を区別しない仕様のため
- メモは詳細画面を開いたときだけ読む。一覧では読まない
- 用具の `holderName` は表示用のコピー。表示名はチーム内の members が正とする。表示名を変えたときは対象チームで自分が持っている用具の `holderName` も更新する
- 用具名の重複判定は、名前を正規化（NFKC・小文字化・空白除去）して比べる。Firestore 版では、正規化した名前を ID にした `teams/{teamId}/equipmentNames/{key}` を同じ書き込みで作り、ルールで「すでに存在するなら作れない」ようにして重複を防ぐ
- **Firestore**：チームを離れる・登録削除するときは、用具をトランザクションで1点ずつ解放し、所持数が0のときのみ「`members/{uid}` の削除」「`users/{uid}.teamIds` から対象だけを削除し、対象を選択中なら残りの先頭へ切り替え」を同じトランザクションで行う。途中失敗では所属が残り、再実行できる（理由は `docs/decisions.md`）
- **モック（複数チーム所属）**：チームを離れる・登録削除するときは、同じ書き込みで「`members/{uid}` の削除」「`users/{uid}.teamIds` から対象チームだけを削除し、選択中なら残りのチームへ切り替え」「その人が持っている用具の `holderUid` を `null` に」をまとめて行う
- Firebase 版も複数所属・削除に対応する（#24）。削除中の状態と再開手順は本書末尾を参照。

## セキュリティルールの方針

サーバーを持たないため、ルールが実質のバックエンド。Firebase エミュレータでテストを書く。

- **チームのデータ**：そのチームの `members/{uid}` が存在する人だけが読み書きできる
- **参加**：自分の `members/{uid}` を作るときは、`role` が `"member"` であり、`joinCodes/{joinCode}.teamId` がそのチームと一致する場合のみ許可
- **チーム作成**：同じ書き込みでチームを作り、作成者本人を `role: "admin"` で登録する場合のみ許可（`getAfter` で確認）
- **参加コード**：`joinCodes` は1件ずつの取得（`get`）のみ許可し、一覧取得（`list`）は禁止して総当たりを防ぐ。作成・削除は管理者のみ
- **予定の編集**：`settings.eventEditPolicy` が `"admins"` なら管理者のみ、`"all"` ならメンバー全員
- **出欠**：変更してよいのは `attendance` の中の **自分の uid のキーだけ**（`diff().affectedKeys()` で検証）
- **メモ**：作成は本人名義のみ、削除は本人のみ
- **用具**：`holderUid` を変えられるのは「`null` → 自分」と「自分 → `null`」のみ。ただし管理者は「他人 → `null`」（強制的に手放させる）もできる。`name` は全員が編集できる（重複不可）
- **権限**：`role` の変更は管理者のみ。`adminUid` の参照先が書き込み後も管理者として存在することを `getAfter` で検証し、管理者が0人になる変更をルール側でも防ぐ
- **チーム名**：変更は管理者のみ
- **離脱・登録削除**：自分の `members/{uid}` は本人が削除できる。他人の `members/{uid}` の削除と、その人の `users/{uid}.teamIds` から対象チームだけを削除し、選択中なら残りのチームへ切り替えする操作は、同じチームの管理者のみ

## リアルタイム更新

- 一定間隔で取りに行く処理は作らない。Firestore の `onSnapshot` で、変更があったら自動で画面に反映する
- 画面が前面に戻ったとき（`visibilitychange`）は、リスナーを張り直す（iOS がバックグラウンドで接続を切るため）
- 再取得ボタンを押したときも、リスナーを張り直す
- オフラインキャッシュ（`persistentLocalCache`）を有効にし、起動直後はキャッシュから表示する

## モック段階での扱い

- データの読み書きは「リポジトリ」のインターフェースを通す
- モックではメモリ上のデータを返す実装を使い、実装段階で Firestore 版に差し替える
- 型はこのファイルの構造に合わせる

## Firestore実装と検証

`src/data/firebase/` にSDK実装、`firestore.rules` にセキュリティルール、`tests/firestore.test.ts` にエミュレータの拒否テストと統合テストを置く。起動・アカウントの扱い・追加フィールドと制約は `docs/firebase.md` を参照。用具名のNFKC正規化はSDKで行い、ルール言語の制約上、改変クライアントのUnicode互換文字すべてを同一視する保証はしない。

## Firebase の複数所属・チーム削除（#24）

所属索引は最大20件。旧 `teamId` のみのプロフィールを読み込め、認証復元時に `teamIds` を追加する。参加・作成は名前と所属を同時に保存する。`users.displayName` はアカウント名のまま保持し、チームのメンバー名との一致は要求しない。

削除は `deletionUid` の保存 → 各予定のメモ → 各予定 → 用具 → 用具名予約 → 参加コード／非公開コード → 各メンバーの所属更新と削除 → 削除者の所属・メンバー・チーム親の同時削除の順。最大100件の清掃バッチを用い、メンバーのプロフィールは1人ずつ最新値を再確認する。全員の他チームへの所属と選択状態を保存し、対象が選択中の場合だけ残りの先頭へ切り替える。

削除中も所属者はチームの状態を読めるが、通常の書き込みは不可。清掃は開始者のみが可能。親と開始者の所属が残るので、通信失敗後も画面から再実行できる。詳細と旧版データの制約は `docs/decisions.md` を参照。

### 残存する所属IDの修復（#97）

チーム配下の購読が権限拒否となった場合、プロフィールをサーバーのトランザクションで読み直し、対象IDだけを `teamIds` から除き、`membershipChangeTeamId` に記録する。選択中なら `teamId` を残りの先頭または `null` にする。既存の `removal()` が本人メンバーの不存在と対象1件だけの除去を検証するため、ルールの追加・変更は不要。有効な所属の削除・任意の所属追加・他人の索引変更は許可しない。

## 場所とアカウント設定（#45・#68・#100）

- `teams/{teamId}.settings.places?: string[]`：順序付きの候補一覧。最大20件・各1〜100文字・重複不可。旧データの未設定は空一覧。予定の `place` へ値をコピーし、以後は独立する。
- `users/{uid}.deletingAccount?: boolean`：アカウント削除の進行中フラグ。本人のみ変更でき、途中失敗後の中断ではfalseに戻せる。未設定はfalse。参加・作成・用具取得を止め、既存の用具解放・所属解除は許可する。
- プロフィールの削除は本人・未所属（`teamIds` 空かつ `teamId = null`）・削除フラグtrue・直近5分の本人認証をルールで要求する。
- アカウント名更新は既存の本人 `displayName` 更新ルールを使い、チームの名前・所持用具には書き込まない。
