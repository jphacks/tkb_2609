import { useId, useLayoutEffect, useRef, useState } from 'react'
import { EyeIcon, EyeOffIcon } from './icons'
import styles from './PasswordInput.module.css'

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
  // type を切り替えるとカーソルが末尾へ移るブラウザがあるため、切り替え前の位置に戻す
  const selection = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    const el = input.current
    if (!el || !selection.current || document.activeElement !== el) return
    el.setSelectionRange(...selection.current)
    selection.current = null
  }, [visible])

  const toggle = () => {
    const el = input.current
    if (el && document.activeElement === el) selection.current = [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length]
    setVisible((v) => !v)
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
        <button
          type="button"
          className={`icon-btn ${styles.toggle}`}
          aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示'}
          aria-pressed={visible}
          aria-controls={id}
          // 押してもパスワード欄からフォーカスを外さない（キーボードを閉じない）
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
        >
          {visible ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
        </button>
      </div>
    </div>
  )
}
