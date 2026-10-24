/** HTTP の LAN プレビューや Clipboard API が拒否されるブラウザにも対応する。 */
export async function copyText(text: string): Promise<boolean> {
  const legacyCopy = () => {
    const previous = document.activeElement
    const input = document.createElement('textarea')
    input.value = text
    input.readOnly = true
    input.setAttribute('aria-label', 'コピーするテキスト')
    Object.assign(input.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px' })
    document.body.append(input)
    try {
      input.focus({ preventScroll: true })
      input.select()
      input.setSelectionRange(0, text.length)
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      input.remove()
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    }
  }

  if (!navigator.clipboard?.writeText) return legacyCopy()
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy()
  }
}
