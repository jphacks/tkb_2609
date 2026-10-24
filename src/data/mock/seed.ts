// モック用の初期データ。日付は「今日」を基準に作る。
import type { EquipmentItem, Member, StoredAttendance, TeamEvent } from '../../types'
import type { MockDb, StoredEvent } from './mockRepository'

export const MOCK_PASSWORD = 'Bukatsu#2026'

export const MOCK_ACCOUNTS = [
  { email: 'admin@example.com', label: '管理者' },
  { email: 'member@example.com', label: 'メンバー' },
  { email: 'newcomer@example.com', label: 'チーム未所属' },
]

/** モックの「Google でログイン」で使うアカウント（初回はチーム未所属） */
export const MOCK_GOOGLE_ACCOUNT = { email: 'google-user@example.com', displayName: 'Google 太郎' }

const TEAM_ID = 'team-sample'

const MEMBERS: [uid: string, name: string, role: Member['role']][] = [
  ['u-admin', '山田 太郎', 'admin'],
  ['u-member', '佐藤 花子', 'member'],
  ['u-03', '鈴木 一郎', 'member'],
  ['u-04', '高橋 美咲', 'member'],
  ['u-05', '田中 翔太', 'member'],
  ['u-06', '伊藤 結衣', 'member'],
  ['u-07', '渡辺 大輝', 'member'],
  ['u-08', '中村 さくら', 'admin'],
  ['u-09', '小林 蓮', 'member'],
  ['u-10', '加藤 陽菜', 'member'],
  ['u-11', '吉田 悠真', 'member'],
  ['u-12', '山本 葵', 'member'],
]

function at(daysFromToday: number, hours: number, minutes = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(hours, minutes, 0, 0)
  return d
}

function event(
  id: string,
  days: number,
  time: [number, number],
  typeId: string,
  title: string,
  place: string | null,
  attendance: Record<string, StoredAttendance> = {},
): StoredEvent {
  const e: TeamEvent = {
    id,
    title,
    typeId,
    startAt: at(days, ...time),
    place,
    attendance,
    createdBy: 'u-admin',
    updatedAt: at(-1, 20),
  }
  return { ...e, notes: {} }
}

function item(id: string, name: string, holder?: string): EquipmentItem {
  const holderName = holder ? (MEMBERS.find(([uid]) => uid === holder)?.[1] ?? null) : null
  return { id, name, holderUid: holder ?? null, holderName, updatedAt: at(-1, 18) }
}

export function createSeed(): MockDb {
  const members = Object.fromEntries(
    MEMBERS.map(([uid, displayName, role]) => [uid, { uid, displayName, role, joinedAt: at(-30, 12) }]),
  )

  const events = [
    event('ev-1', 0, [15, 45], 'practice', '放課後練習', '第2グラウンド', { 'u-03': 'late', 'u-06': 'absent' }),
    event('ev-2', 1, [16, 0], 'practice', '放課後練習', '第2グラウンド', { 'u-09': 'observe' }),
    event('ev-3', 3, [8, 30], 'match', '練習試合 vs 桜ヶ丘高校', '桜ヶ丘高校', {
      'u-04': 'absent',
      'u-10': 'leave_early',
    }),
    event('ev-4', 5, [16, 0], 'practice', '放課後練習', '第2グラウンド'),
    event('ev-5', 7, [7, 45], 'match', '地区大会 1回戦', '市民総合運動公園 第1競技場'),
    event('ev-6', 9, [16, 0], 'practice', '放課後練習', null),
    event('ev-7', 12, [9, 0], 'practice', '休日練習（午前）', '第2グラウンド'),
  ]
  events[0].notes = {
    'n-1': {
      id: 'n-1',
      authorUid: 'u-admin',
      authorName: '山田 太郎',
      body: '雨の場合は体育館でミーティングに変更します。',
      createdAt: at(-1, 21, 5),
    },
    'n-2': {
      id: 'n-2',
      authorUid: 'u-03',
      authorName: '鈴木 一郎',
      body: '委員会があるので20分ほど遅れます。',
      createdAt: at(0, 7, 40),
    },
  }

  const equipment = [
    item('eq-1', 'ボール袋', 'u-member'),
    item('eq-2', 'ビブス', 'u-member'),
    item('eq-3', 'コーン'),
    item('eq-4', '救急箱', 'u-03'),
    item('eq-5', 'ストップウォッチ'),
    item('eq-6', '空気入れ', 'u-04'),
    item('eq-7', 'ホイッスル'),
    item('eq-8', '作戦ボード'),
    item('eq-9', '給水ジャグ', 'u-admin'),
    item('eq-10', 'マーカー'),
  ]

  return {
    accounts: {
      'u-admin': { uid: 'u-admin', email: 'admin@example.com', password: MOCK_PASSWORD },
      'u-member': { uid: 'u-member', email: 'member@example.com', password: MOCK_PASSWORD },
      'u-newcomer': { uid: 'u-newcomer', email: 'newcomer@example.com', password: MOCK_PASSWORD },
    },
    users: {
      ...Object.fromEntries(MEMBERS.map(([uid, displayName]) => [uid, { displayName, teamIds: [TEAM_ID], teamId: TEAM_ID }])),
      'u-newcomer': { displayName: '新入 部員', teamIds: [], teamId: null },
    },
    joinCodes: { K7MPX2QA: TEAM_ID },
    teams: {
      [TEAM_ID]: {
        name: 'サンプルチーム',
        createdBy: 'u-admin',
        createdAt: at(-30, 12),
        settings: {
          eventEditPolicy: 'admins',
          eventTypes: [
            { id: 'practice', label: '練習', color: '#2563eb' },
            { id: 'match', label: '試合', color: '#e8590c' },
          ],
        },
        joinCode: 'K7MPX2QA',
        members,
        events: Object.fromEntries(events.map((e) => [e.id, e])),
        equipment: Object.fromEntries(equipment.map((e) => [e.id, e])),
      },
    },
  }
}
