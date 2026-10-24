# データ構造（Firestore）

すべてのチームデータは `teams/{teamId}` の下に置き、複数チームに対応できるようにする。

## コレクション

```
users/{uid}
  displayName: string
  teamId: string | null

joinCodes/{code}                       … 参加コード → チームの対応表
  teamId: string
  createdAt: Timestamp

teams/{teamId}
  name: string
  createdBy: uid
  createdAt: Timestamp
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

teams/{teamId}/events/{eventId}
  title: string
  typeId: string                       … settings.eventTypes の id
  startAt: Timestamp                   … 日付と集合時間
  place: string | null
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
  holderUid: uid | null
  holderName: string | null            … 表示用にコピーして持つ
  updatedAt: Timestamp
```

### 設計上のポイント

- **出欠は予定のドキュメントの中にまとめて持つ。** 部員ごとに別ドキュメントにすると、一覧表示のたびに「人数 × 予定数」回の読み取りが発生し、無料枠を超える
- 「出席」は保存しない（キーを削除する）。未回答と出席を区別しない仕様のため
- メモは詳細画面を開いたときだけ読む。一覧では読まない
- 用具の `holderName` は表示用のコピー。表示名を変えたときは自分が持っている用具の `holderName` も更新する
- 用具名の重複判定は、名前を正規化（NFKC・小文字化・空白除去）して比べる。Firestore 版では、正規化した名前を ID にした `teams/{teamId}/equipmentNames/{key}` を同じ書き込みで作り、ルールで「すでに存在するなら作れない」ようにして重複を防ぐ
- チームを離れる・登録削除するときは、同じ書き込みで「`members/{uid}` の削除」「`users/{uid}.teamId` を `null` に」「その人が持っている用具の `holderUid` を `null` に」をまとめて行う

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
- **権限**：`role` の変更は管理者のみ。管理者が 0 人になる変更は、クライアント側でも防ぐ
- **チーム名**：変更は管理者のみ
- **離脱・登録削除**：自分の `members/{uid}` は本人が削除できる。他人の `members/{uid}` の削除と、その人の `users/{uid}.teamId` を `null` にする操作は、同じチームの管理者のみ

## リアルタイム更新

- 一定間隔で取りに行く処理は作らない。Firestore の `onSnapshot` で、変更があったら自動で画面に反映する
- 画面が前面に戻ったとき（`visibilitychange`）は、リスナーを張り直す（iOS がバックグラウンドで接続を切るため）
- 再取得ボタンを押したときも、リスナーを張り直す
- オフラインキャッシュ（`persistentLocalCache`）を有効にし、起動直後はキャッシュから表示する

## モック段階での扱い

- データの読み書きは「リポジトリ」のインターフェースを通す
- モックではメモリ上のデータを返す実装を使い、実装段階で Firestore 版に差し替える
- 型はこのファイルの構造に合わせる
