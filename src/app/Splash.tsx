import { AppLogo } from '../components/AppLogo'
import styles from './app.module.css'

export function Splash() {
  return (
    <div className={styles.splash} aria-busy="true">
      <AppLogo size={56} />
      <span className={styles.splashName}>BUKATSU</span>
    </div>
  )
}
