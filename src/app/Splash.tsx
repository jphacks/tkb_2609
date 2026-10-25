import styles from './app.module.css'

export function Splash() {
  return (
    <div className={styles.splash} aria-busy="true">
      <img src="/icons/bukatsu-bu-192.png" alt="" width={56} height={56} />
      <span className={styles.splashName}>BUKATSU</span>
    </div>
  )
}
