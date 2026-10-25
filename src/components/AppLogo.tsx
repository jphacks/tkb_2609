import styles from './AppLogo.module.css'

/** 旧ロゴ（64pxに対して半径14px）と同じ比率の角丸で表示する。 */
export function AppLogo({ size = 52 }: { size?: number }) {
  return <img className={styles.logo} src="/icons/bukatsu-bu-192.png" alt="" width={size} height={size} />
}
