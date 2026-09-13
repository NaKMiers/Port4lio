import { useSyncExternalStore } from 'react'

/**
 * `false` while rendering on the server and for the hydrating pass, `true` afterwards.
 *
 * The CCA-F page has several values that depend on *today* - how many days until the exam,
 * which day card is the current one - and today is not a property of the render, it is a
 * property of the machine doing it. A server rendering at 23:58 and a reader loading at
 * 00:02 disagree by a day, and the answer is additionally baked into a 60-second cache
 * shared by every visitor.
 *
 * So nothing date-dependent is computed until this returns true, and the components render
 * a dash in the meantime.
 *
 * The `useSyncExternalStore` form is deliberate, copied from `AnimatedCounter`: a
 * `useEffect` that calls `setState` does the same job but trips `react-hooks/set-state-in-effect`,
 * and it earns the lint error - it schedules a second render where this schedules none.
 * The subscribe function never fires because the value it reports can only change once.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}
