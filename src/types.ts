// Firestore Timestamp is mapped to epoch milliseconds at the repository boundary.
export type Timestamp = number;
export type Role = "admin" | "member";
export type Attendance =
  "present" | "absent" | "observe" | "late" | "leave_early";
export interface User {
  uid: string;
  displayName: string;
  teamId: string | null;
}
export interface Member {
  uid: string;
  displayName: string;
  role: Role;
  joinedAt: Timestamp;
  joinCode: string;
}
export interface EventType {
  id: string;
  label: string;
  color: string;
}
export interface Team {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp;
  settings: { eventEditPolicy: "admins" | "all"; eventTypes: EventType[] };
}
export interface TeamEvent {
  id: string;
  title: string;
  typeId: string;
  startAt: Timestamp;
  place: string | null;
  attendance: Record<string, Exclude<Attendance, "present">>;
  createdBy: string;
  updatedAt: Timestamp;
}
export interface Note {
  id: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt: Timestamp;
}
export interface Equipment {
  id: string;
  name: string;
  reading: string | null;
  holderUid: string | null;
  holderName: string | null;
  updatedAt: Timestamp;
}
export type EventInput = Pick<
  TeamEvent,
  "title" | "typeId" | "startAt" | "place"
>;
export interface Snapshot {
  user: User | null;
  team: Team | null;
  members: Member[];
  events: TeamEvent[];
  equipment: Equipment[];
  joinCode: string | null;
}
export const attendanceLabels: Record<Attendance, string> = {
  present: "出席",
  absent: "欠席",
  observe: "見学",
  late: "遅刻",
  leave_early: "早退",
};
