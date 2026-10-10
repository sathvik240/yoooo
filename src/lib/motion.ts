const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

export const reducedMotion = (): boolean => Boolean(mq?.matches)

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion() ? 0 : ms))

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

/** Wait for a CSS animation/transition on el, with a timeout so we never hang. */
export function settle(el: Element, ms: number): Promise<void> {
  if (reducedMotion()) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('animationend', finish)
      el.removeEventListener('transitionend', finish)
      resolve()
    }
    el.addEventListener('animationend', finish)
    el.addEventListener('transitionend', finish)
    setTimeout(finish, ms + 50)
  })
}
