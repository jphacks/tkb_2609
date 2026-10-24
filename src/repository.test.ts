import { describe, expect, it } from "vitest";
import { MemoryRepository, sortEquipment } from "./repository";
const admin = () => {
  const r = new MemoryRepository();
  r.demo("admin");
  return r;
};
describe("memory repository", () => {
  it("represents presence by removing the attendance key", () => {
    const r = admin();
    r.setAttendance("event-1", "absent");
    expect(r.getSnapshot().events[0].attendance["demo-admin"]).toBe("absent");
    r.setAttendance("event-1", "present");
    expect(r.getSnapshot().events[0].attendance).not.toHaveProperty(
      "demo-admin",
    );
  });
  it("prevents a second holder and permits only own release for members", () => {
    const r = admin();
    r.demo("member");
    r.takeEquipment("item-1");
    expect(() => r.takeEquipment("item-1")).toThrow();
    expect(() => r.releaseEquipment("item-3")).toThrow();
    r.releaseEquipment("item-1");
    expect(r.getSnapshot().equipment[0].holderUid).toBeNull();
  });
  it("allows admin forced release and protects last admin", () => {
    const r = admin();
    r.releaseEquipment("item-3");
    expect(r.getSnapshot().equipment[2].holderUid).toBeNull();
    expect(() => r.setRole("demo-admin", "member")).toThrow();
    r.setRole("demo-member", "admin");
    r.setRole("demo-admin", "member");
    expect(r.getSnapshot().members[0].role).toBe("member");
  });
  it("enforces event policy without restricting attendance", () => {
    const r = admin();
    r.demo("member");
    expect(() => r.deleteEvent("event-1")).toThrow();
    r.setAttendance("event-1", "observe");
    r.demo("admin");
    r.updateSettings({
      ...r.getSnapshot().team!.settings,
      eventEditPolicy: "all",
    });
    r.demo("member");
    r.deleteEvent("event-1");
    expect(r.getSnapshot().events).toHaveLength(2);
  });
  it("only deletes own notes, returns copies and updates holder names", () => {
    const r = admin();
    expect(() => r.deleteNote("event-1", "note-1")).toThrow();
    r.addNote("event-1", "テスト");
    const own = r.getNotes("event-1")[1];
    r.deleteNote("event-1", own.id);
    expect(r.getNotes("event-1")).toHaveLength(1);
    const s = r.getSnapshot();
    s.events[0].title = "changed externally";
    r.refresh();
    expect(r.getSnapshot().events[0].title).not.toBe("changed externally");
    r.demo("member");
    r.changeName("新しい名前");
    expect(r.getSnapshot().equipment[1].holderName).toBe("新しい名前");
  });
  it("invalidates old codes and scopes team data", async () => {
    const r = admin();
    const code = r.regenerateCode();
    r.logout();
    await r.register("テスト", "test@example.invalid", "Mock123!");
    expect(() => r.joinTeam("ABCD2345")).toThrow();
    r.joinTeam(code);
    expect(r.getSnapshot().team?.id).toBe("demo-team");
    expect(r.getSnapshot().joinCode).toBeNull();
    r.logout();
    await r.register("別チーム", "other@example.invalid", "Mock123!");
    r.createTeam("新しいチーム");
    expect(r.getSnapshot().events).toHaveLength(0);
    expect(r.getSnapshot().equipment).toHaveLength(0);
    expect(r.getSnapshot().members[0].role).toBe("admin");
  });
  it("sorts available equipment first and uses readings", () => {
    const r = admin();
    const items = sortEquipment(r.getSnapshot().equipment);
    expect(items.map((i) => i.id)).toEqual(["item-1", "item-3", "item-2"]);
  });
  it("validates registration and keeps account membership after logout", async () => {
    const r = admin();
    r.logout();
    await expect(r.register("名前", "bad", "weak")).rejects.toThrow();
    await r.register("名前", "account@example.invalid", "Mock123!");
    r.createTeam("テストチーム");
    r.logout();
    await expect(r.login("account@example.invalid", "wrong")).rejects.toThrow();
    await r.login("account@example.invalid", "Mock123!");
    expect(r.getSnapshot().team?.name).toBe("テストチーム");
  });
});
