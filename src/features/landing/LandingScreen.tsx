import type { CSSProperties } from 'react'
import { AppLogo } from '../../components/AppLogo'
import {
  ArrowRightIcon,
  BoxIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  GearIcon,
  PinIcon,
  RefreshIcon,
} from '../../components/icons'
import styles from './landing.module.css'

const ATTENDANCE_LABELS = ['出席', '欠席', '見学', '遅刻', '早退'] as const
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const

const STEPS = [
  {
    step: '1',
    title: '管理者がチームを作る',
    description:
      'アカウントを作成し、チーム名とチーム内で使う自分の表示名を入力すると、すぐに新しいチームが作られます。',
  },
  {
    step: '2',
    title: '参加コードを共有する',
    description:
      '設定タブに表示される「アプリのリンク」と8文字の「参加コード」をコピーして、連絡グループなどでメンバーに送ります。',
  },
  {
    step: '3',
    title: 'メンバーが参加する',
    description:
      'メンバーは共有されたリンクから登録・ログインし、参加コードと自分の表示名を入力するとその場で参加できます。',
  },
] as const

const FAQS = [
  {
    question: '利用料金はかかりますか？',
    answer:
      'すべての機能を完全無料で利用できます。チームの作成やメンバーの追加による料金も一切かかりません。',
  },
  {
    question: 'スマホや LINE 内ブラウザでも使えますか？',
    answer:
      'はい、iPhone・Android・PC のブラウザに対応しています。LINE 内ブラウザでも使えます。管理者が共有するアプリのリンクは、LINE から開くと外部ブラウザで開きます。',
  },
  {
    question: '1人で複数のチームに所属できますか？',
    answer:
      'はい、1つのアカウントで複数のチームに参加・作成できます。チームごとに別の表示名を設定でき、画面上部のヘッダーからいつでも表示するチームを切り替えられます。',
  },
  {
    question: '参加コードが部外者に知られた場合はどうすればよいですか？',
    answer:
      '管理者が設定タブから参加コードをいつでも再発行できます。再発行すると古いコードは無効になり、すでに参加しているメンバーには影響しません。',
  },
] as const

/** 未ログイン時に表示するアプリ紹介ページ（#73）。Firestore の読み取りは行わない */
export function LandingScreen({ onSignUp, onLogin }: { onSignUp(): void; onLogin(): void }) {
  return (
    <div id="top" className={styles.page}>
      <a href="#main-content" className={styles.skipLink}>
        コンテンツへスキップ
      </a>

      <header role="banner" className={styles.header}>
        <div className={styles.headerInner}>
          <a
            href="#top"
            className={styles.logoLink}
            aria-label="BUKATSU トップへ戻る"
            onClick={() => window.scrollTo({ top: 0 })}
          >
            <AppLogo size={51} />
            <span className={styles.logoText}>BUKATSU</span>
          </a>

          <nav className={styles.nav} aria-label="ページ内メニュー">
            <a href="#features" className={styles.navLink}>
              機能
            </a>
            <a href="#how-to-use" className={styles.navLink}>
              使い方
            </a>
            <a href="#faq" className={styles.navLink}>
              よくある質問
            </a>
          </nav>

          <button type="button" className={styles.headerCta} onClick={onLogin}>
            <ArrowRightIcon size={24} />
            <span>ログイン</span>
          </button>
        </div>
      </header>

      <main id="main-content">
        {/* ファーストビュー */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>チームのための予定・用具管理アプリ</span>
              <h1 className={styles.heroTitle}>予定と出欠、用具の所在を、チームでひとつに。</h1>
              <p className={styles.heroLead}>
                BUKATSU は、チームの「次の予定と出欠」と「誰がどの用具を持っているか」を、スマホのブラウザでかんたんに共有できる無料の Web アプリです。
              </p>

              <div className={styles.heroActions}>
                <button type="button" className={styles.primaryCta} onClick={onSignUp}>
                  <span>無料ではじめる</span>
                  <ArrowRightIcon size={20} />
                </button>
                <button type="button" className={styles.secondaryCta} onClick={onLogin}>
                  ログイン
                </button>
              </div>

              <ul className={styles.heroPoints}>
                <li>
                  <CheckIcon size={16} />
                  完全無料
                </li>
                <li>
                  <CheckIcon size={16} />
                  アプリのインストール不要
                </li>
                <li>
                  <CheckIcon size={16} />
                  参加コードですぐ合流
                </li>
              </ul>
            </div>

            {/* ファーストビューのアプリ画面風イラスト */}
            <div className={styles.mockupFrame} aria-hidden="true">
              <div className={styles.mockupBar}>
                <span className={styles.mockupTeam}>
                  サンプルチーム
                  <ChevronDownIcon size={16} />
                </span>
                <span className={styles.mockupRefresh}>
                  <RefreshIcon size={16} />
                </span>
              </div>

              <div className={styles.sampleEventCard} style={{ '--sample-color': '#2563eb' } as CSSProperties}>
                <div className={styles.sampleEventTop}>
                  <span>10/26(月)</span>
                  <span className={styles.sampleBadge}>明日</span>
                  <span className={styles.sampleTypeBadge}>練習</span>
                </div>
                <p className={styles.sampleEventTitle}>全体ミーティング・活動</p>
                <div className={styles.sampleMeta}>
                  <span className={styles.sampleMetaItem}>
                    <ClockIcon size={14} />
                    集合 09:00
                  </span>
                  <span className={styles.sampleMetaItem}>
                    <PinIcon size={14} />
                    第1活動室
                  </span>
                </div>
                <div className={styles.sampleAttRow}>
                  {ATTENDANCE_LABELS.map((label, index) => (
                    <span
                      key={label}
                      className={`${styles.sampleAttPill} ${index === 0 ? styles.sampleAttActive : ''}`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.sampleWidget}>
                <div className={styles.sampleWidgetHead}>
                  <span>あなたが持っている用具</span>
                  <span className={styles.sampleWidgetCount}>1</span>
                </div>
                <div className={styles.sampleWidgetItem}>
                  <span>救急箱</span>
                  <span className={styles.sampleReleaseBadge}>手放す</span>
                </div>
              </div>

              <div className={styles.sampleTabbar}>
                <span className={`${styles.sampleTabItem} ${styles.sampleTabActive}`}>
                  <CalendarIcon size={18} />
                  予定
                </span>
                <span className={styles.sampleTabItem}>
                  <BoxIcon size={18} />
                  用具
                </span>
                <span className={styles.sampleTabItem}>
                  <GearIcon size={18} />
                  設定
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 機能紹介（見出し・説明と画面風イラストを交互に配置） */}
        <section id="features" className={styles.section}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>FEATURES</span>
              <h2 className={styles.sectionTitle}>BUKATSU でできること</h2>
              <p className={styles.sectionDesc}>
                日々の活動でよく使う機能だけに絞り、スマホの片手操作でも迷わず使える画面にまとめています。
              </p>
            </div>

            <div className={styles.featureList}>
              {/* 機能1：予定と出欠・毎週の予定の一括追加 */}
              <div className={styles.featureRow}>
                <div className={styles.featureText}>
                  <span className={styles.featureBadge}>
                    <CalendarIcon size={16} />
                    予定と出欠
                  </span>
                  <h3 className={styles.featureTitle}>
                    予定の確認から出欠の回答・毎週の一括追加までかんたん
                  </h3>
                  <p className={styles.featureLead}>
                    今日以降の予定が日程の近い順にリストで並び、日付・種類・集合時間・場所がカードを開く前にひと目でわかります。出欠は5つのボタン（出席・欠席・見学・遅刻・早退）からワンタップで回答できます。
                  </p>
                  <ul className={styles.featurePoints}>
                    <li>
                      <CheckIcon size={18} />
                      <span>未回答は「出席」として扱うため、変更があるメンバーだけ押せば連絡が完了します</span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>
                        <strong>毎週の予定の一括追加</strong>に対応。曜日と期間（開始日〜終了日）を選ぶだけで、定例の予定をまとめて登録できます
                      </span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>詳細画面ではメンバー全員の出欠一覧と、全員が書き込めるメモ欄を共有できます</span>
                    </li>
                  </ul>
                </div>

                <div className={styles.mockupFrame} aria-hidden="true">
                  <div className={styles.sampleEventCard} style={{ '--sample-color': '#2563eb' } as CSSProperties}>
                    <div className={styles.sampleEventTop}>
                      <span>10/27(火)</span>
                      <span className={styles.sampleTypeBadge}>練習</span>
                    </div>
                    <p className={styles.sampleEventTitle}>定例活動</p>
                    <div className={styles.sampleMeta}>
                      <span className={styles.sampleMetaItem}>
                        <ClockIcon size={14} />
                        集合 16:30
                      </span>
                      <span className={styles.sampleMetaItem}>
                        <PinIcon size={14} />
                        第2活動室
                      </span>
                    </div>
                    <div className={styles.sampleAttRow}>
                      {ATTENDANCE_LABELS.map((label, index) => (
                        <span
                          key={label}
                          className={`${styles.sampleAttPill} ${index === 0 ? styles.sampleAttActive : ''}`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={styles.sampleWeeklyBox}>
                    <div className={styles.sampleWeeklyHead}>
                      <span>毎週の予定を一括追加</span>
                      <span className={styles.sampleBadge}>毎週 火・木</span>
                    </div>
                    <div className={styles.sampleWeekdays}>
                      {WEEKDAYS.map((day) => {
                        const active = day === '火' || day === '木'
                        return (
                          <span
                            key={day}
                            className={`${styles.sampleDay} ${active ? styles.sampleDayActive : ''}`}
                          >
                            {day}
                          </span>
                        )
                      })}
                    </div>
                    <span className="hint">期間内の対象日を確認して、一度にまとめて追加できます</span>
                  </div>
                </div>
              </div>

              {/* 機能2：用具を誰が持っているか */}
              <div className={`${styles.featureRow} ${styles.featureRowReverse}`}>
                <div className={styles.featureText}>
                  <span className={styles.featureBadge}>
                    <BoxIcon size={16} />
                    用具の所在
                  </span>
                  <h3 className={styles.featureTitle}>
                    「あの用具、いま誰が持ってる？」をすぐに解決
                  </h3>
                  <p className={styles.featureLead}>
                    チームの共用備品や鍵・用具を一覧で管理。誰も持っていない用具が上に、誰かが持っている用具が下に自動で並び替わり、枠の色でも状態を見分けられます。
                  </p>
                  <ul className={styles.featurePoints}>
                    <li>
                      <CheckIcon size={18} />
                      <span>画面上部の「あなたが持っている用具」から、持っている用具をワンタップで手放せます</span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>用具の追加・名前変更・削除はメンバー全員が可能。同じ名前の重複登録は自動で防ぎます</span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>持ち主が来られないときは、管理者が代わりに手放せます。チームを離れたメンバーの用具は自動で手放した状態になります</span>
                    </li>
                  </ul>
                </div>

                <div className={styles.mockupFrame} aria-hidden="true">
                  <div className={styles.sampleWidget}>
                    <div className={styles.sampleWidgetHead}>
                      <span>あなたが持っている用具</span>
                      <span className={styles.sampleWidgetCount}>1</span>
                    </div>
                    <div className={styles.sampleWidgetItem}>
                      <span>救急箱</span>
                      <span className={styles.sampleReleaseBadge}>手放す</span>
                    </div>
                  </div>

                  <div className={styles.sampleEquipList}>
                    <div className={styles.sampleEquipRow}>
                      <span>タイマー</span>
                      <span className={styles.sampleHoldBadge}>持つ</span>
                    </div>
                    <div className={styles.sampleEquipRow}>
                      <span>ホワイトボード</span>
                      <span className={styles.sampleHoldBadge}>持つ</span>
                    </div>
                    <div className={`${styles.sampleEquipRow} ${styles.sampleEquipRowHeld}`}>
                      <span>収納ケース</span>
                      <span className={styles.sampleHolderChip}>山田</span>
                    </div>
                    <div className={`${styles.sampleEquipRow} ${styles.sampleEquipRowHeld}`}>
                      <span>延長コード</span>
                      <span className={styles.sampleHolderChip}>佐藤</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 機能3：参加コード・複数チーム・管理者の権限設定 */}
              <div className={styles.featureRow}>
                <div className={styles.featureText}>
                  <span className={styles.featureBadge}>
                    <GearIcon size={16} />
                    チーム管理と権限設定
                  </span>
                  <h3 className={styles.featureTitle}>
                    参加コードで即参加。複数チームや権限設定も柔軟に
                  </h3>
                  <p className={styles.featureLead}>
                    メンバーの招待から複数チームの掛け持ち、チームごとの運営ルール設定まで、余計な手間なく管理できます。
                  </p>
                  <ul className={styles.featurePoints}>
                    <li>
                      <CheckIcon size={18} />
                      <span>
                        <strong>参加コードでの参加</strong>：設定タブの「アプリのリンク」と「参加コード」をコピーして送るだけ。コードはいつでも再発行できます
                      </span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>
                        <strong>複数チームに対応</strong>：1つのアカウントで複数チームに所属し、ヘッダーのチーム名からすぐに切り替えられます
                      </span>
                    </li>
                    <li>
                      <CheckIcon size={18} />
                      <span>
                        <strong>管理者の権限設定</strong>：予定を編集できる範囲（管理者のみ／全員）や予定の種類・色、メンバーの管理者権限を設定できます
                      </span>
                    </li>
                  </ul>
                </div>

                <div className={styles.mockupFrame} aria-hidden="true">
                  <div className={styles.mockupBar}>
                    <span className={styles.mockupTeam}>
                      サンプルチーム（切り替え可）
                      <ChevronDownIcon size={16} />
                    </span>
                    <span className={styles.sampleBadge}>複数チーム対応</span>
                  </div>

                  <div className={styles.sampleSettingCard}>
                    <div className={styles.sampleSettingRow}>
                      <span className="label">参加コード</span>
                      <span className={styles.sampleCodeValue}>
                        K7MPX2QA
                        <CopyIcon size={15} />
                      </span>
                    </div>
                    <div className={styles.sampleSettingRow}>
                      <span className="label">予定を編集できる人</span>
                    </div>
                    <div className={styles.sampleSegment}>
                      <span className={styles.sampleSegmentActive}>管理者のみ</span>
                      <span className={styles.sampleSegmentInactive}>全員</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 使い方 */}
        <section id="how-to-use" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>HOW TO USE</span>
              <h2 className={styles.sectionTitle}>3ステップではじめられます</h2>
              <p className={styles.sectionDesc}>
                個別承認の待ち時間はなく、参加コードを共有するだけでメンバー全員がすぐに使いはじめられます。
              </p>
            </div>

            <ol className={styles.steps}>
              {STEPS.map((item) => (
                <li key={item.step} className={styles.stepCard}>
                  <span className={styles.stepNumber}>{item.step}</span>
                  <h3 className={styles.stepTitle}>{item.title}</h3>
                  <p className={styles.stepDesc}>{item.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* よくある質問 */}
        <section id="faq" className={styles.section}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>FAQ</span>
              <h2 className={styles.sectionTitle}>よくある質問</h2>
            </div>

            <div className={styles.faqList}>
              {FAQS.map((item) => (
                <article key={item.question} className={styles.faqItem}>
                  <h3 className={styles.faqQuestion}>{item.question}</h3>
                  <p className={styles.faqAnswer}>{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 下部のアプリ誘導セクション */}
        <section className={styles.bottomCta}>
          <div className={styles.bottomCtaInner}>
            <h2 className={styles.bottomCtaTitle}>チームの管理を、もっとシンプルに。</h2>
            <p className={styles.bottomCtaLead}>
              アカウントの作成もチームの利用もすべて無料です。まずは新しいアカウントを作成して、チームの予定と用具管理をはじめましょう。
            </p>
            <div className={styles.bottomCtaActions}>
              <button type="button" className={styles.bottomPrimaryBtn} onClick={onSignUp}>
                <span>無料ではじめる</span>
                <ArrowRightIcon size={20} />
              </button>
              <button type="button" className={styles.bottomSecondaryBtn} onClick={onLogin}>
                ログイン
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <AppLogo size={28} />
            <span>BUKATSU</span>
          </div>
          <p className={styles.footerCopy}>© 2026 BUKATSU</p>
        </div>
      </footer>
    </div>
  )
}
