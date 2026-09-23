/**
 * A ref callback that focuses and selects an input one tick after it mounts. React Flow
 * focuses a newly selected node's wrapper after render, and a plain `autoFocus` loses that
 * race - the first keystrokes then go to the wrapper instead of the field.
 */
export function focusSoon(el: HTMLInputElement | null) {
  if (!el) return
  setTimeout(() => {
    el.focus()
    el.select()
  }, 30)
}
