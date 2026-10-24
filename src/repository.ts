import type {
  Attendance,
  Equipment,
  EventInput,
  Member,
  Note,
  Role,
  Snapshot,
  Team,
  User,
} from "./types";
export interface Repository {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  logout(): void;
  demo(role: Role): void;
  joinTeam(code: string): void;
  createTeam(name: string): void;
  saveEvent(input: EventInput, id?: string): void;
  deleteEvent(id: string): void;
  setAttendance(id: string, status: Attendance): void;
  getNotes(eventId: string): Note[];
  addNote(eventId: string, body: string): void;
  deleteNote(eventId: string, noteId: string): void;
  saveEquipment(name: string, reading: string, id?: string): void;
  deleteEquipment(id: string): void;
  takeEquipment(id: string): void;
  releaseEquipment(id: string): void;
  changeName(name: string): void;
  updateSettings(settings: Team["settings"]): void;
  setRole(uid: string, role: Role): void;
  regenerateCode(): string;
}
export const strongPassword = (value: string) =>
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9\s]/.test(value);
export const sortEquipment = (items: Equipment[]) =>
  [...items].sort(
    (a, b) =>
      Number(!!a.holderUid) - Number(!!b.holderUid) ||
      (a.reading || a.name).localeCompare(b.reading || b.name, "ja"),
  );
export const canEditEvents = (s: Snapshot) =>
  s.team?.settings.eventEditPolicy === "all" ||
  s.members.find((m) => m.uid === s.user?.uid)?.role === "admin";
const defaultTypes = () => [
  { id: "practice", label: "練習", color: "#36836b" },
  { id: "match", label: "試合", color: "#c47736" },
];
const initialTeam = (): Team => ({
  id: "demo-team",
  name: "青葉チーム",
  createdBy: "demo-admin",
  createdAt: Date.now(),
  settings: { eventEditPolicy: "admins", eventTypes: defaultTypes() },
});
const nonEmpty = (s: string) => {
  if (!s.trim()) throw new Error("空欄の項目を入力してください。");
  return s.trim();
};
const id = () => crypto.randomUUID();

export class MemoryRepository implements Repository {
  private listeners = new Set<() => void>();
  private accounts = new Map<string, { password: string; user: User }>();
  private teams = new Map<
    string,
    {
      team: Team;
      members: Member[];
      events: Snapshot["events"];
      equipment: Equipment[];
      code: string;
      notes: Map<string, Note[]>;
    }
  >();
  private current: User | null = null;
  private snapshot: Snapshot = {
    user: null,
    team: null,
    members: [],
    events: [],
    equipment: [],
    joinCode: null,
  };
  constructor() {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const next = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d.getTime();
    };
    this.teams.set("demo-team", {
      team: initialTeam(),
      code: "ABCD2345",
      members: [
        {
          uid: "demo-admin",
          displayName: "はる",
          role: "admin",
          joinedAt: Date.now(),
          joinCode: "",
        },
        {
          uid: "demo-member",
          displayName: "あおい",
          role: "member",
          joinedAt: Date.now(),
          joinCode: "ABCD2345",
        },
        {
          uid: "demo-other",
          displayName: "そら",
          role: "member",
          joinedAt: Date.now(),
          joinCode: "ABCD2345",
        },
      ],
      events: [
        {
          id: "event-1",
          title: "みんなで朝の練習",
          typeId: "practice",
          startAt: next(1),
          place: "第2広場",
          attendance: { "demo-other": "late" },
          createdBy: "demo-admin",
          updatedAt: Date.now(),
        },
        {
          id: "event-2",
          title: "週末の交流会",
          typeId: "match",
          startAt: next(3),
          place: "市民センター",
          attendance: { "demo-member": "absent" },
          createdBy: "demo-admin",
          updatedAt: Date.now(),
        },
        {
          id: "event-3",
          title: "夕方の練習",
          typeId: "practice",
          startAt: next(5),
          place: "中央広場",
          attendance: {},
          createdBy: "demo-admin",
          updatedAt: Date.now(),
        },
      ],
      equipment: [
        {
          id: "item-1",
          name: "救急セット",
          reading: "きゅうきゅうせっと",
          holderUid: null,
          holderName: null,
          updatedAt: Date.now(),
        },
        {
          id: "item-2",
          name: "タイマー",
          reading: "たいまー",
          holderUid: "demo-member",
          holderName: "あおい",
          updatedAt: Date.now(),
        },
        {
          id: "item-3",
          name: "記録ボード",
          reading: "きろくぼーど",
          holderUid: "demo-other",
          holderName: "そら",
          updatedAt: Date.now(),
        },
      ],
      notes: new Map([
        [
          "event-1",
          [
            {
              id: "note-1",
              authorUid: "demo-other",
              authorName: "そら",
              body: "少し遅れて合流します！",
              createdAt: Date.now(),
            },
          ],
        ],
      ]),
    });
    // Only a demo identity is persisted. Emails and passwords never enter browser storage.
    try {
      const role = localStorage.getItem("bukatsu-demo-role");
      if (role === "admin" || role === "member") this.demo(role);
    } catch {
      /* Storage may be unavailable in embedded browsers. */
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private data() {
    const d = this.current?.teamId && this.teams.get(this.current.teamId);
    if (!d || !d.members.some((m) => m.uid === this.current?.uid))
      throw new Error("チームに参加してください。");
    return d;
  }
  private admin() {
    if (
      this.data().members.find((m) => m.uid === this.current?.uid)?.role !==
      "admin"
    )
      throw new Error("管理者のみ操作できます。");
  }
  private editor() {
    if (!canEditEvents(this.snapshot))
      throw new Error("予定を編集できるのは管理者のみです。");
  }
  private signedIn() {
    if (!this.current) throw new Error("ログインしてください。");
    return this.current;
  }
  refresh = () => {
    const d = this.current?.teamId
      ? this.teams.get(this.current.teamId)
      : undefined;
    this.snapshot = structuredClone({
      user: this.current,
      team: d?.team ?? null,
      members: d?.members ?? [],
      events: d?.events ?? [],
      equipment: d?.equipment ?? [],
      joinCode:
        d?.members.find((m) => m.uid === this.current?.uid)?.role === "admin"
          ? d.code
          : null,
    });
    this.listeners.forEach((l) => l());
  };
  async login(email: string, password: string) {
    const a = this.accounts.get(email.trim().toLowerCase());
    if (!a || a.password !== password)
      throw new Error("メールアドレスまたはパスワードが違います。");
    this.current = a.user;
    this.refresh();
  }
  async register(name: string, email: string, password: string) {
    const key = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key))
      throw new Error("メールアドレスを確認してください。");
    if (this.accounts.has(key))
      throw new Error("登録済みのメールアドレスです。");
    if (!strongPassword(password))
      throw new Error("パスワードの条件を満たしてください。");
    const user: User = { uid: id(), displayName: nonEmpty(name), teamId: null };
    this.accounts.set(key, { user, password });
    this.current = user;
    this.clearDemo();
    this.refresh();
  }
  async resetPassword(email: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("メールアドレスを確認してください。");
  }
  private clearDemo() {
    try {
      localStorage.removeItem("bukatsu-demo-role");
    } catch {
      /* Optional storage. */
    }
  }
  logout() {
    this.current = null;
    this.clearDemo();
    this.refresh();
  }
  demo(role: Role) {
    this.current = {
      uid: `demo-${role}`,
      displayName: this.teams
        .get("demo-team")!
        .members.find((m) => m.uid === `demo-${role}`)!.displayName,
      teamId: "demo-team",
    };
    try {
      localStorage.setItem("bukatsu-demo-role", role);
    } catch {
      /* Optional storage. */
    }
    this.refresh();
  }
  joinTeam(code: string) {
    const user = this.signedIn();
    if (user.teamId) throw new Error("すでにチームに所属しています。");
    const d = [...this.teams.values()].find(
      (t) => t.code === code.trim().toUpperCase(),
    );
    if (!d) throw new Error("参加コードが見つかりません。");
    user.teamId = d.team.id;
    d.members.push({
      uid: user.uid,
      displayName: user.displayName,
      role: "member",
      joinedAt: Date.now(),
      joinCode: d.code,
    });
    this.refresh();
  }
  private newCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from(
        crypto.getRandomValues(new Uint8Array(8)),
        (n) => alphabet[n % alphabet.length],
      ).join("");
    } while ([...this.teams.values()].some((t) => t.code === code));
    return code;
  }
  createTeam(name: string) {
    const user = this.signedIn();
    if (user.teamId) throw new Error("すでにチームに所属しています。");
    const team: Team = {
      id: id(),
      name: nonEmpty(name),
      createdBy: user.uid,
      createdAt: Date.now(),
      settings: { eventEditPolicy: "admins", eventTypes: defaultTypes() },
    };
    const code = this.newCode();
    this.teams.set(team.id, {
      team,
      code,
      members: [
        {
          uid: user.uid,
          displayName: user.displayName,
          role: "admin",
          joinedAt: Date.now(),
          joinCode: "",
        },
      ],
      events: [],
      equipment: [],
      notes: new Map(),
    });
    user.teamId = team.id;
    this.refresh();
  }
  saveEvent(input: EventInput, eventId?: string) {
    this.editor();
    const d = this.data();
    if (
      !d.team.settings.eventTypes.some((t) => t.id === input.typeId) ||
      !Number.isFinite(input.startAt)
    )
      throw new Error("種類・日時を確認してください。");
    const values = {
      ...input,
      title: nonEmpty(input.title),
      place: input.place?.trim() || null,
      updatedAt: Date.now(),
    };
    if (eventId) Object.assign(this.event(eventId), values);
    else
      d.events.push({
        ...values,
        id: id(),
        attendance: {},
        createdBy: this.current!.uid,
      });
    this.refresh();
  }
  private event(eventId: string) {
    const e = this.data().events.find((e) => e.id === eventId);
    if (!e) throw new Error("予定が見つかりません。");
    return e;
  }
  deleteEvent(eventId: string) {
    this.editor();
    const d = this.data();
    this.event(eventId);
    d.events = d.events.filter((e) => e.id !== eventId);
    d.notes.delete(eventId);
    this.refresh();
  }
  setAttendance(eventId: string, status: Attendance) {
    const e = this.event(eventId);
    if (status === "present") delete e.attendance[this.current!.uid];
    else e.attendance[this.current!.uid] = status;
    e.updatedAt = Date.now();
    this.refresh();
  }
  getNotes(eventId: string) {
    this.event(eventId);
    return structuredClone(this.data().notes.get(eventId) ?? []);
  }
  addNote(eventId: string, body: string) {
    this.event(eventId);
    const d = this.data();
    d.notes.set(eventId, [
      ...(d.notes.get(eventId) ?? []),
      {
        id: id(),
        authorUid: this.current!.uid,
        authorName: this.current!.displayName,
        body: nonEmpty(body),
        createdAt: Date.now(),
      },
    ]);
    this.refresh();
  }
  deleteNote(eventId: string, noteId: string) {
    this.event(eventId);
    const d = this.data();
    const notes = d.notes.get(eventId) ?? [];
    if (notes.find((n) => n.id === noteId)?.authorUid !== this.current!.uid)
      throw new Error("自分のメモのみ削除できます。");
    d.notes.set(
      eventId,
      notes.filter((n) => n.id !== noteId),
    );
    this.refresh();
  }
  saveEquipment(name: string, reading: string, itemId?: string) {
    const d = this.data();
    const values = {
      name: nonEmpty(name),
      reading: reading.trim() || null,
      updatedAt: Date.now(),
    };
    if (itemId) Object.assign(this.item(itemId), values);
    else
      d.equipment.push({
        ...values,
        id: id(),
        holderUid: null,
        holderName: null,
      });
    this.refresh();
  }
  private item(itemId: string) {
    const i = this.data().equipment.find((i) => i.id === itemId);
    if (!i) throw new Error("用具が見つかりません。");
    return i;
  }
  deleteEquipment(itemId: string) {
    const d = this.data();
    this.item(itemId);
    d.equipment = d.equipment.filter((i) => i.id !== itemId);
    this.refresh();
  }
  takeEquipment(itemId: string) {
    const i = this.item(itemId);
    if (i.holderUid) throw new Error("この用具はすでに持たれています。");
    i.holderUid = this.current!.uid;
    i.holderName = this.current!.displayName;
    i.updatedAt = Date.now();
    this.refresh();
  }
  releaseEquipment(itemId: string) {
    const i = this.item(itemId);
    if (i.holderUid !== this.current!.uid) this.admin();
    i.holderUid = null;
    i.holderName = null;
    i.updatedAt = Date.now();
    this.refresh();
  }
  changeName(name: string) {
    const user = this.signedIn();
    user.displayName = nonEmpty(name);
    if (user.teamId) {
      const d = this.data();
      d.members.find((m) => m.uid === user.uid)!.displayName = user.displayName;
      d.equipment
        .filter((i) => i.holderUid === user.uid)
        .forEach((i) => {
          i.holderName = user.displayName;
          i.updatedAt = Date.now();
        });
    }
    this.refresh();
  }
  updateSettings(settings: Team["settings"]) {
    this.admin();
    if (
      !settings.eventTypes.length ||
      settings.eventTypes.some(
        (t) => !t.label.trim() || !/^#[0-9a-f]{6}$/i.test(t.color),
      )
    )
      throw new Error("種類名と色を確認してください。");
    this.data().team.settings = structuredClone(settings);
    this.refresh();
  }
  setRole(uid: string, role: Role) {
    this.admin();
    const d = this.data();
    const m = d.members.find((m) => m.uid === uid);
    if (!m) throw new Error("メンバーが見つかりません。");
    if (
      m.role === "admin" &&
      role === "member" &&
      d.members.filter((m) => m.role === "admin").length === 1
    )
      throw new Error("最後の管理者は解除できません。");
    m.role = role;
    this.refresh();
  }
  regenerateCode() {
    this.admin();
    const code = this.newCode();
    this.data().code = code;
    this.refresh();
    return code;
  }
}
export const repository: Repository = new MemoryRepository();
