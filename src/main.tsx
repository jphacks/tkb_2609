import React, { useState, useSyncExternalStore, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { FormEvent, ReactNode } from "react";
import {
  repository as repo,
  canEditEvents,
  sortEquipment,
  strongPassword,
} from "./repository";
import { attendanceLabels } from "./types";
import type {
  Attendance,
  Equipment,
  EventInput,
  Snapshot,
  TeamEvent,
  Team,
} from "./types";
import "./style.css";

const date = (n: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(n);
const time = (n: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(n);
const localDate = (n: number) => {
  const d = new Date(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function App() {
  const s = useSyncExternalStore(repo.subscribe, repo.getSnapshot);
  const [tab, setTab] = useState("events");
  const [selected, setSelected] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<TeamEvent | "new" | null>(null);
  const [itemForm, setItemForm] = useState<Equipment | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const run = (action: () => void, message = "") => {
    try {
      action();
      setError("");
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作できませんでした。");
    }
  };
  useEffect(() => {
    const listener = () => {
      if (document.visibilityState === "visible") repo.refresh();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, selected, eventForm, itemForm, s.user?.uid]);
  const admin = s.members.find((m) => m.uid === s.user?.uid)?.role === "admin";
  const event = s.events.find((e) => e.id === selected);
  return (
    <div className="app">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setSelected(null);
            setTab("events");
          }}
        >
          <span className="brand-mark">b.</span>
          <span>
            <small>BUKATSU</small>
            <strong>{s.team?.name ?? "チームの毎日を、ひとつに。"}</strong>
          </span>
        </a>
        <button
          className="refresh"
          aria-label="データを再取得"
          onClick={() =>
            run(() => repo.refresh(), "最新のデータを取得しました。")
          }
        >
          ↻
        </button>
      </header>
      <div className="mock-banner">
        MOCK PREVIEW <span>データ・認証はデモです</span>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button aria-label="エラーを閉じる" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <main>
        {!s.user ? (
          <Auth onError={setError} onNotice={setNotice} />
        ) : !s.team ? (
          <TeamEntry run={run} />
        ) : (
          <>
            {eventForm ? (
              <EventForm
                key={typeof eventForm === "string" ? "new" : eventForm.id}
                event={eventForm === "new" ? undefined : eventForm}
                types={s.team.settings.eventTypes}
                onClose={() => setEventForm(null)}
                onSave={(input) =>
                  run(() => {
                    repo.saveEvent(
                      input,
                      eventForm === "new" ? undefined : eventForm.id,
                    );
                    setEventForm(null);
                  }, "予定を保存しました。")
                }
              />
            ) : itemForm ? (
              <ItemForm
                item={itemForm === "new" ? undefined : itemForm}
                onClose={() => setItemForm(null)}
                onSave={(name, reading) =>
                  run(() => {
                    repo.saveEquipment(
                      name,
                      reading,
                      itemForm === "new" ? undefined : itemForm.id,
                    );
                    setItemForm(null);
                  }, "用具を保存しました。")
                }
              />
            ) : tab === "events" ? (
              event ? (
                <EventDetail
                  s={s}
                  event={event}
                  onBack={() => setSelected(null)}
                  onEdit={() => setEventForm(event)}
                  onDelete={() => {
                    if (confirm("この予定とメモを削除しますか？"))
                      run(() => {
                        repo.deleteEvent(event.id);
                        setSelected(null);
                      }, "予定を削除しました。");
                  }}
                  run={run}
                />
              ) : (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">TEAM SCHEDULE</p>
                      <h1>これからの予定</h1>
                      <p>集まる日も、持ちものも。ここで確認。</p>
                    </div>
                    <span className="today">
                      {new Date().getMonth() + 1}
                      <small>月</small>
                    </span>
                  </div>
                  <div className="section-title">
                    <h2>予定一覧</h2>
                    <span>日程が近い順</span>
                  </div>
                  {s.events
                    .filter(
                      (e) =>
                        e.startAt >=
                        new Date(localDate(Date.now()) + "T00:00").getTime(),
                    )
                    .sort((a, b) => a.startAt - b.startAt)
                    .map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        s={s}
                        onOpen={() => setSelected(e.id)}
                        run={run}
                      />
                    ))}
                  {!s.events.some(
                    (e) =>
                      e.startAt >=
                      new Date(localDate(Date.now()) + "T00:00").getTime(),
                  ) && (
                    <div className="empty">これからの予定はありません。</div>
                  )}
                  {canEditEvents(s) && (
                    <button className="add" onClick={() => setEventForm("new")}>
                      ＋ 予定を追加
                    </button>
                  )}
                </>
              )
            ) : tab === "equipment" ? (
              <>
                <div className="page-heading">
                  <p className="eyebrow">TEAM EQUIPMENT</p>
                  <h1>用具のいま</h1>
                  <p>誰が持っているか、ひと目で。</p>
                </div>
                <section className="my-items">
                  <div className="section-title">
                    <h2>あなたが持っている用具</h2>
                    <span>
                      {
                        s.equipment.filter((i) => i.holderUid === s.user!.uid)
                          .length
                      }
                      点
                    </span>
                  </div>
                  <div className="my-items-scroll">
                    {s.equipment
                      .filter((i) => i.holderUid === s.user!.uid)
                      .map((i) => (
                        <div className="row" key={i.id}>
                          <strong>{i.name}</strong>
                          <button
                            onClick={() =>
                              run(
                                () => repo.releaseEquipment(i.id),
                                "用具を手放しました。",
                              )
                            }
                          >
                            手放す
                          </button>
                        </div>
                      ))}
                    {!s.equipment.some((i) => i.holderUid === s.user!.uid) && (
                      <>
                        <p>持っている用具はありません</p>
                        <button disabled>手放す</button>
                      </>
                    )}
                  </div>
                </section>
                <div className="section-title">
                  <h2>すべての用具</h2>
                  <span>空いている用具から・50音順</span>
                </div>
                {sortEquipment(s.equipment).map((i) => (
                  <article
                    className={`equipment ${i.holderUid ? "held" : ""}`}
                    key={i.id}
                  >
                    <div className="row">
                      <div>
                        <strong>{i.name}</strong>
                        <p>
                          {i.holderUid
                            ? `${i.holderName} が持っています`
                            : "誰も持っていません"}
                        </p>
                      </div>
                      {!i.holderUid ? (
                        <button
                          className="primary compact"
                          onClick={() =>
                            run(
                              () => repo.takeEquipment(i.id),
                              "用具を持ちました。",
                            )
                          }
                        >
                          持つ
                        </button>
                      ) : (
                        <span className="badge">
                          {i.holderUid === s.user!.uid
                            ? "あなた"
                            : i.holderName}
                        </span>
                      )}
                    </div>
                    <details>
                      <summary>用具の操作</summary>
                      <div className="actions">
                        <button onClick={() => setItemForm(i)}>編集</button>
                        <button
                          className="danger"
                          onClick={() => {
                            if (confirm(`「${i.name}」を削除しますか？`))
                              run(
                                () => repo.deleteEquipment(i.id),
                                "用具を削除しました。",
                              );
                          }}
                        >
                          削除
                        </button>
                        {admin &&
                          i.holderUid &&
                          i.holderUid !== s.user!.uid && (
                            <button
                              className="danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    `${i.holderName}さんが持っている「${i.name}」を手放させますか？`,
                                  )
                                )
                                  run(
                                    () => repo.releaseEquipment(i.id),
                                    "用具を手放させました。",
                                  );
                              }}
                            >
                              手放させる
                            </button>
                          )}
                      </div>
                    </details>
                  </article>
                ))}
                {!s.equipment.length && (
                  <div className="empty">
                    用具を追加して、チームで共有しましょう。
                  </div>
                )}
                <button className="add" onClick={() => setItemForm("new")}>
                  ＋ 用具を追加
                </button>
              </>
            ) : (
              <Settings
                key={s.user.uid}
                s={s}
                admin={admin}
                run={run}
                onLogout={() => {
                  repo.logout();
                  setSelected(null);
                  setTab("events");
                }}
              />
            )}
          </>
        )}
      </main>
      {s.user && s.team && (
        <nav aria-label="メインメニュー">
          {[
            ["events", "▤", "予定"],
            ["equipment", "▣", "用具"],
            ["settings", "⚙", "設定"],
          ].map(([key, icon, title]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setSelected(null);
                setEventForm(null);
                setItemForm(null);
                setError("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
type Run = (action: () => void, message?: string) => void;
function Auth({
  onError,
  onNotice,
}: {
  onError: (s: string) => void;
  onNotice: (s: string) => void;
}) {
  const [mode, setMode] = useState("login");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const email = String(f.get("email"));
      if (mode === "reset") {
        await repo.resetPassword(email);
        onNotice(
          "モックのためメールは送信しません。画面の動作のみ確認できます。",
        );
      } else if (mode === "register")
        await repo.register(String(f.get("name")), email, password);
      else await repo.login(email, password);
      onError("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "操作できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="welcome">
        <p className="eyebrow">LESS HASSLE. MORE TEAM.</p>
        <h1>
          チームの時間を、
          <br />
          もっとシンプルに。
        </h1>
        <p>
          予定を確認。出欠を回答。用具を共有。
          <br />
          みんなの「いま」が集まる場所。
        </p>
      </section>
      <section className="panel">
        <h2>
          {mode === "register"
            ? "新規登録"
            : mode === "reset"
              ? "パスワード再設定"
              : "おかえりなさい"}
        </h2>
        <form onSubmit={submit}>
          {mode === "register" && (
            <Field label="表示名">
              <input
                name="name"
                autoComplete="nickname"
                required
                maxLength={40}
              />
            </Field>
          )}
          <Field label="メールアドレス">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          {mode !== "reset" && (
            <Field label="パスワード">
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {mode === "register" && (
            <p className="hint">
              大文字・小文字・数字・記号を含めてください。
              <br />
              {[
                ["大文字", /[A-Z]/],
                ["小文字", /[a-z]/],
                ["数字", /\d/],
                ["記号", /[^A-Za-z0-9\s]/],
              ].map(([label, pattern]) => (
                <span
                  className={
                    (pattern as RegExp).test(password) ? "fulfilled" : ""
                  }
                  key={String(label)}
                >
                  {(pattern as RegExp).test(password) ? "✓" : "○"}{" "}
                  {String(label)}　
                </span>
              ))}
            </p>
          )}
          <button
            className="primary full"
            disabled={
              busy || (mode === "register" && !strongPassword(password))
            }
          >
            {mode === "register"
              ? "登録してはじめる"
              : mode === "reset"
                ? "再設定をリクエスト"
                : "ログイン"}
          </button>
        </form>
        <div className="auth-links">
          {mode !== "login" && (
            <button
              onClick={() => {
                setMode("login");
                onError("");
              }}
            >
              ログインへ
            </button>
          )}
          {mode !== "register" && (
            <button
              onClick={() => {
                setMode("register");
                onError("");
              }}
            >
              新規登録
            </button>
          )}
          {mode === "login" && (
            <button
              onClick={() => {
                setMode("reset");
                onError("");
              }}
            >
              パスワードを忘れた方
            </button>
          )}
        </div>
      </section>
      <section className="demo">
        <h2>まずは、さわってみる</h2>
        <p>登録なしで、モック画面を確認できます。</p>
        <div className="actions">
          <button onClick={() => repo.demo("admin")}>管理者として体験 →</button>
          <button onClick={() => repo.demo("member")}>
            メンバーとして体験 →
          </button>
        </div>
        <p className="hint">
          登録アカウントとデータは再読み込みでリセットされます。実際のパスワードは入力しないでください。
        </p>
      </section>
    </>
  );
}
function TeamEntry({ run }: { run: Run }) {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">WELCOME TO BUKATSU</p>
        <h1>チームとつながろう</h1>
        <p>こんにちは、{repo.getSnapshot().user?.displayName}さん。</p>
      </div>
      <section className="panel">
        <h2>チームに参加</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () => repo.joinTeam(String(f.get("code"))),
              "チームに参加しました。",
            );
          }}
        >
          <Field label="参加コード">
            <input
              name="code"
              required
              autoCapitalize="characters"
              placeholder="例：ABCD2345"
            />
          </Field>
          <p className="hint">デモチームのコード：ABCD2345</p>
          <button className="primary full">参加する</button>
        </form>
      </section>
      <section className="panel">
        <h2>新しくチームを作る</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () => repo.createTeam(String(f.get("name"))),
              "チームを作成しました。",
            );
          }}
        >
          <Field label="チーム名">
            <input name="name" required maxLength={60} />
          </Field>
          <button className="full">チームを作る</button>
        </form>
      </section>
      <button onClick={() => repo.logout()}>ログアウト</button>
    </>
  );
}
function AttendanceButtons({
  event,
  s,
  run,
}: {
  event: TeamEvent;
  s: Snapshot;
  run: Run;
}) {
  return (
    <div className="attendance" aria-label="あなたの出欠">
      {(Object.entries(attendanceLabels) as [Attendance, string][]).map(
        ([key, label]) => (
          <button
            key={key}
            aria-pressed={(event.attendance[s.user!.uid] ?? "present") === key}
            onClick={() =>
              run(
                () => repo.setAttendance(event.id, key),
                `${label}に変更しました。`,
              )
            }
          >
            {label}
          </button>
        ),
      )}
    </div>
  );
}
function EventCard({
  event,
  s,
  onOpen,
  run,
}: {
  event: TeamEvent;
  s: Snapshot;
  onOpen: () => void;
  run: Run;
}) {
  const type = s.team!.settings.eventTypes.find((t) => t.id === event.typeId);
  return (
    <article className="event-card" style={{ borderLeftColor: type?.color }}>
      <button className="event-open" onClick={onOpen}>
        <div className="row">
          <span className="event-date">{date(event.startAt)}</span>
          <span
            className="type-badge"
            style={{ color: type?.color, borderColor: type?.color }}
          >
            {type?.label}
          </span>
        </div>
        <h2>{event.title}</h2>
        <p className="truncate">
          集合 {time(event.startAt)} <span>・</span> {event.place || "場所未定"}
        </p>
      </button>
      <AttendanceButtons event={event} s={s} run={run} />
    </article>
  );
}
function EventDetail({
  s,
  event,
  onBack,
  onEdit,
  onDelete,
  run,
}: {
  s: Snapshot;
  event: TeamEvent;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  run: Run;
}) {
  const notes = repo.getNotes(event.id);
  return (
    <>
      <button className="back" onClick={onBack}>
        ← 予定一覧
      </button>
      <EventCard s={s} event={event} onOpen={() => {}} run={run} />
      {canEditEvents(s) && (
        <div className="actions">
          <button onClick={onEdit}>予定を編集</button>
          <button className="danger" onClick={onDelete}>
            予定を削除
          </button>
        </div>
      )}
      <section className="panel">
        <h2>みんなの出欠</h2>
        {(Object.entries(attendanceLabels) as [Attendance, string][]).map(
          ([key, label]) => {
            const members = s.members.filter(
              (m) => (event.attendance[m.uid] ?? "present") === key,
            );
            return (
              <div className="attendance-group" key={key}>
                <strong>
                  {label} <span>{members.length}人</span>
                </strong>
                <p>{members.map((m) => m.displayName).join("、") || "—"}</p>
              </div>
            );
          },
        )}
      </section>
      <section className="panel">
        <h2>
          メモ <span className="count">{notes.length}</span>
        </h2>
        {notes.length === 0 && (
          <p className="hint">連絡したいことをメモしましょう。</p>
        )}
        {notes.map((n) => (
          <article className="note" key={n.id}>
            <div className="row">
              <strong>{n.authorName}</strong>
              <small>
                {date(n.createdAt)} {time(n.createdAt)}
              </small>
            </div>
            <p>{n.body}</p>
            {n.authorUid === s.user!.uid && (
              <button
                className="danger"
                onClick={() => {
                  if (confirm("このメモを削除しますか？"))
                    run(() => repo.deleteNote(event.id, n.id));
                }}
              >
                削除
              </button>
            )}
          </article>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            run(() => {
              repo.addNote(event.id, String(f.get("body")));
              form.reset();
            }, "メモを追加しました。");
          }}
        >
          <Field label="メモを書く">
            <textarea name="body" required maxLength={1000} rows={3} />
          </Field>
          <button className="primary full">メモを追加</button>
        </form>
      </section>
    </>
  );
}
function EventForm({
  event,
  types,
  onClose,
  onSave,
}: {
  event?: TeamEvent;
  types: Team["settings"]["eventTypes"];
  onClose: () => void;
  onSave: (input: EventInput) => void;
}) {
  return (
    <>
      <button className="back" onClick={onClose}>
        ← 戻る
      </button>
      <section className="panel">
        <h1>{event ? "予定を編集" : "予定を追加"}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onSave({
              title: String(f.get("title")),
              typeId: String(f.get("typeId")),
              startAt: new Date(`${f.get("date")}T${f.get("time")}`).getTime(),
              place: String(f.get("place")) || null,
            });
          }}
        >
          <Field label="種類">
            <select name="typeId" defaultValue={event?.typeId}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="予定名">
            <input
              name="title"
              required
              defaultValue={event?.title}
              maxLength={100}
            />
          </Field>
          <Field label="日付">
            <input
              name="date"
              type="date"
              required
              defaultValue={localDate(event?.startAt ?? Date.now())}
            />
          </Field>
          <Field label="集合時間">
            <input
              name="time"
              type="time"
              required
              defaultValue={event ? time(event.startAt) : "09:00"}
            />
          </Field>
          <Field label="場所（任意）">
            <input
              name="place"
              defaultValue={event?.place ?? ""}
              maxLength={120}
            />
          </Field>
          <button className="primary full">保存する</button>
        </form>
      </section>
    </>
  );
}
function ItemForm({
  item,
  onClose,
  onSave,
}: {
  item?: Equipment;
  onClose: () => void;
  onSave: (name: string, reading: string) => void;
}) {
  return (
    <>
      <button className="back" onClick={onClose}>
        ← 戻る
      </button>
      <section className="panel">
        <h1>{item ? "用具を編集" : "用具を追加"}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onSave(String(f.get("name")), String(f.get("reading")));
          }}
        >
          <Field label="用具名">
            <input
              name="name"
              required
              defaultValue={item?.name}
              maxLength={60}
            />
          </Field>
          <Field label="よみがな（任意）">
            <input
              name="reading"
              defaultValue={item?.reading ?? ""}
              maxLength={100}
            />
          </Field>
          <button className="primary full">保存する</button>
        </form>
      </section>
    </>
  );
}
function Settings({
  s,
  admin,
  run,
  onLogout,
}: {
  s: Snapshot;
  admin: boolean;
  run: Run;
  onLogout: () => void;
}) {
  const [settings, setSettings] = useState(structuredClone(s.team!.settings));
  useEffect(() => {
    setSettings(structuredClone(s.team!.settings));
  }, [s.team]);
  const [shareError, setShareError] = useState("");
  const inviteText = `${s.team!.name}の参加コード：${s.joinCode}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteText);
      setShareError("コピーしました。");
    } catch {
      setShareError(
        "コピーできませんでした。コードを長押ししてコピーしてください。",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR TEAM, YOUR WAY</p>
        <h1>設定</h1>
        <p>
          {s.team!.name}{" "}
          <span className="badge">{admin ? "管理者" : "メンバー"}</span>
        </p>
      </div>
      <section className="panel">
        <h2>あなたのプロフィール</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () => repo.changeName(String(f.get("name"))),
              "表示名を変更しました。",
            );
          }}
        >
          <Field label="表示名">
            <input
              key={s.user!.displayName}
              name="name"
              required
              defaultValue={s.user!.displayName}
              maxLength={40}
            />
          </Field>
          <button className="full">表示名を保存</button>
        </form>
      </section>
      {admin && (
        <>
          <section className="panel">
            <h2>メンバーを招待</h2>
            <p className="hint">このコードを伝えると、チームに参加できます。</p>
            <p className="join-code">{s.joinCode}</p>
            <div className="actions">
              <button onClick={copy}>コピー</button>
              <a
                className="button"
                href={`https://line.me/R/msg/text/?${encodeURIComponent(inviteText)}`}
                target="_blank"
                rel="noreferrer"
              >
                LINEで共有
              </a>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "参加コードを再発行しますか？古いコードは使えなくなります。",
                    )
                  )
                    run(
                      () => repo.regenerateCode(),
                      "参加コードを再発行しました。",
                    );
                }}
              >
                再発行
              </button>
            </div>
            {shareError && (
              <p role="status" className="hint">
                {shareError}
              </p>
            )}
          </section>
          <section className="panel">
            <h2>予定の設定</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => repo.updateSettings(settings),
                  "チーム設定を保存しました。",
                );
              }}
            >
              <Field label="予定を編集できる人">
                <select
                  value={settings.eventEditPolicy}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      eventEditPolicy: e.target.value as "admins" | "all",
                    })
                  }
                >
                  <option value="admins">管理者のみ</option>
                  <option value="all">全員</option>
                </select>
              </Field>
              <h3>予定の種類</h3>
              {settings.eventTypes.map((t, index) => (
                <div className="type-editor" key={t.id}>
                  <Field label={`種類 ${index + 1}`}>
                    <input
                      required
                      value={t.label}
                      maxLength={30}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          eventTypes: settings.eventTypes.map((x) =>
                            x.id === t.id ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="色">
                    <input
                      type="color"
                      value={t.color}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          eventTypes: settings.eventTypes.map((x) =>
                            x.id === t.id ? { ...x, color: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    eventTypes: [
                      ...settings.eventTypes,
                      { id: crypto.randomUUID(), label: "", color: "#64748b" },
                    ],
                  })
                }
              >
                ＋ 種類を追加
              </button>
              <button className="primary full spaced">チーム設定を保存</button>
            </form>
          </section>
          <section className="panel">
            <h2>
              メンバー <span className="count">{s.members.length}</span>
            </h2>
            {s.members.map((m) => (
              <div className="member row" key={m.uid}>
                <div>
                  <strong>
                    {m.displayName}
                    {m.uid === s.user!.uid ? "（あなた）" : ""}
                  </strong>
                  <p>{m.role === "admin" ? "管理者" : "メンバー"}</p>
                </div>
                <button
                  disabled={
                    m.role === "admin" &&
                    s.members.filter((x) => x.role === "admin").length === 1
                  }
                  onClick={() => {
                    if (
                      confirm(
                        `${m.displayName}さんの管理者権限を${m.role === "admin" ? "解除" : "付与"}しますか？`,
                      )
                    )
                      run(
                        () =>
                          repo.setRole(
                            m.uid,
                            m.role === "admin" ? "member" : "admin",
                          ),
                        "権限を変更しました。",
                      );
                  }}
                >
                  {m.role === "admin" ? "管理者を解除" : "管理者にする"}
                </button>
              </div>
            ))}
            <p className="hint">最後の管理者は解除できません。</p>
          </section>
        </>
      )}
      <button className="full" onClick={onLogout}>
        ログアウト
      </button>
      <p className="footer-note">
        Bukatsu · Mock preview
        <br />
        モックのデータは再読み込みで初期化されます。
      </p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
