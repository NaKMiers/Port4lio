'use client'

import { useState } from 'react'

/**
 * The email capture, at the foot of the index.
 *
 * ## Why the success message never says whether you were already subscribed
 *
 * It renders the same line the API returns for every non-malformed request. The endpoint
 * deliberately cannot distinguish "added", "already confirmed" and "previously unsubscribed"
 * to a caller, because one that could is an email address oracle - anyone could test whether
 * a given person reads this blog. The UI has to hold that line too, or the API's care is
 * undone by a component being helpful.
 *
 * ## Why it does not gate anything
 *
 * No modal, no scroll trigger, no "read 3 more articles" wall. One field at the bottom of the
 * page for somebody who got to the bottom of the page. The blog's job is to make a reader
 * believe the author thinks well; interrupting that to harvest an address trades the only
 * thing the surface has for a metric nobody is measured on.
 */
export default function SubscribeForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('sending')

    try {
      const res = await fetch('/api/blog/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = (await res.json()) as { message?: string; error?: string }

      if (!res.ok) {
        setState('error')
        setMessage(data.error ?? 'That did not work. Try again in a moment.')
        return
      }

      setState('done')
      setMessage(data.message ?? 'Check your inbox for a confirmation link.')
      setEmail('')
    } catch {
      setState('error')
      setMessage('That did not work. Try again in a moment.')
    }
  }

  return (
    <section className='mt-16 rounded-panel border border-pp-line bg-[var(--pp-panel)] p-6'>
      <h2 className='font-display text-lg font-semibold text-pp-text'>
        Told when there is something new
      </h2>
      <p className='mt-2 max-w-[58ch] text-sm leading-relaxed text-pp-muted'>
        A handful of write-ups a year, sent by hand. No newsletter cadence, no drip sequence,
        nothing else ever. Unsubscribe from any of them in one click.
      </p>

      <form onSubmit={submit} className='mt-4 flex flex-wrap gap-3'>
        <label className='sr-only' htmlFor='subscribe-email'>
          Email address
        </label>
        <input
          id='subscribe-email'
          type='email'
          required
          value={email}
          disabled={state === 'sending'}
          onChange={event => setEmail(event.target.value)}
          placeholder='you@example.com'
          className='min-w-[14rem] flex-1 rounded-full border border-pp-line bg-white/78 px-5 py-2.5 text-sm text-pp-text outline-none transition focus:border-pp-blue/55'
        />
        <button
          type='submit'
          disabled={state === 'sending'}
          className='inline-flex min-h-[44px] items-center rounded-full bg-pp-text px-6 py-2.5 font-display text-sm font-semibold text-[var(--pp-bg)] disabled:opacity-60'
        >
          {state === 'sending' ? 'Sending...' : 'Subscribe'}
        </button>
      </form>

      {message ? (
        <p
          role={state === 'error' ? 'alert' : 'status'}
          className='mt-3 text-sm text-pp-muted'
        >
          {message}
        </p>
      ) : null}

      <p className='mt-3 text-xs text-pp-muted'>
        You will get one email asking you to confirm. Ignore it and nothing happens - you are
        not on any list until you click it.
      </p>
    </section>
  )
}
