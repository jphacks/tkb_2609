import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { EyeIcon, EyeOffIcon } from './icons'
import styles from './PasswordInput.module.css'

type Selection = [start: number, end: number, direction: 'forward' | 'backward' | 'none']

/**
 * 表示・非表示を切り替えられるパスワード入力（#33）。打ち間違いに気づけるようにする。
 * 切り替えても、入力中の文字・カーソル位置・キーボードの表示はそのまま保つ
 */
export function PasswordInput({
  label,
  autoComplete,
  value,
  onChange,
}: {
  label: string
  /** パスワード管理機能（自動入力・保存）が働くよう、表示中も変えない */
  autoComplete: 'current-password' | 'new-password'
  value: string
  onChange(value: string): void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)
  // ボタンを押す直前にパスワード欄を使っていたか。type を切り替えるとカーソルが末尾へ移るブラウザがあるため、位置も覚えておく
  const restore = useRef<Selection | null>(null)

  useLayoutEffect(() => {
    const el = input.current,
      selection = restore.current
    restore.current = null
    if (!el || !selection) return
    // タップでフォーカスが外れる端末もあるため、押す前に使っていたなら戻す（キーボードを閉じない）
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    el.setSelectionRange(...selection)
  }, [visible])

  // 送信するときは非表示に戻す。表示のまま送ると、パスワード管理機能が保存を提案しないことがあり、
  // ログインに失敗したときもパスワードが画面に見えたままになる
  useEffect(() => {
    const el = input.current,
      form = el?.form
    if (!el || !form) return
    const hide = () => {
      el.type = 'password'
      setVisible(false)
    }
    form.addEventListener('submit', hide, true)
    return () => form.removeEventListener('submit', hide, true)
  }, [])

  const remember = () => {
    const el = input.current
    restore.current =
      el && document.activeElement === el
        ? [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, el.selectionDirection ?? 'none']
        : null
  }

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className={styles.wrap}>
        <input
          ref={input}
          id={id}
          className={`input ${styles.input}`}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          // 表示中に iOS の自動修正や先頭の大文字化が効かないようにする
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {/* 名前は固定し、表示中かどうかは aria-pressed で伝える（名前と状態が食い違って読み上げられないように） */}
        <button
          type="button"
          className={`icon-btn ${styles.toggle}`}
          aria-label="パスワードを表示"
          aria-pressed={visible}
          aria-controls={id}
          // 押してもパスワード欄からフォーカスを外さない。外れる端末でも、切り替えたあとに戻す
          onPointerDown={remember}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
        </button>
      </div>
    </div>
  )
}
