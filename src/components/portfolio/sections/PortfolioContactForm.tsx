'use client'

import { useState } from 'react'

import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

const fieldCls =
  'w-full rounded-xl border border-pp-line bg-pp-panel-strong/90 px-4 py-3 text-sm normal-case text-pp-text shadow-[0_1px_0_rgba(31,28,26,0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-pp-muted/75 focus:border-pp-blue/35 focus:shadow-[0_0_0_3px_rgba(51,152,255,0.12)]'

const labelCls = 'block text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted'

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success' } | { kind: 'error'; message: string }

/**
 * Submits JSON to `POST /api/contact` - fields must match the App Router handler.
 *
 * ## Why "How did you hear about me?" is here, and visible
 *
 * It is the highest-information line of UI on this page, for a reason that is not obvious:
 * the blog measures itself with two different instruments, and this is the only one that can
 * catch the case the whole thing exists for.
 *
 * `sourceSlug` is the other instrument, and it only fires when the person who read a post
 * fills in the form themselves. But the actual claim is *referral* - a third person, weeks
 * later, who never saw the post and was told about it by someone who did. That person
 * arrives at `/`, not at a post, so there is no slug to attach and no automated field that
 * could ever record them. A sentence they typed is the only trace such a visit can leave.
 *
 * Optional, and left optional forever: the handler accepts a submission with this blank, and
 * a regression test asserts that it does. Making it required would trade the messages of
 * everyone who does not want to answer for the attribution of the few who do.
 */
export default function PortfolioContactForm() {
  const [email, setEmail] = useState('')
  const [firstname, setFirstname] = useState('')
  const [lastname, setLastname] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [heardAbout, setHeardAbout] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus({ kind: 'loading' })

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstname: firstname.trim(),
          lastname: lastname.trim(),
          subject: subject.trim(),
          message: message.trim(),
          // Omitted entirely when blank rather than sent as `''`. The handler treats an
          // empty string as absent anyway, but a key that is only present when it carries
          // something keeps "nobody answered" and "answered with nothing" distinguishable
          // if that distinction ever matters.
          ...(heardAbout.trim() ? { heardAbout: heardAbout.trim() } : {}),
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }

      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: data.error ?? 'Something went wrong. Please try again.',
        })
        return
      }

      setStatus({ kind: 'success' })
      setEmail('')
      setFirstname('')
      setLastname('')
      setSubject('')
      setMessage('')
      setHeardAbout('')
    } catch {
      setStatus({
        kind: 'error',
        message: 'Network error. Check your connection and try again.',
      })
    }
  }

  const disabled = status.kind === 'loading'

  return (
    <EditorialPanel variant='strong' className='p-6 sm:p-8'>
      <form className='space-y-5' onSubmit={onSubmit} noValidate>
        <div className='space-y-1.5'>
          <label className={labelCls} htmlFor='contact-email'>
            Email
          </label>
          <input
            id='contact-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            disabled={disabled}
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={fieldCls}
            placeholder='you@example.com'
          />
        </div>

        <div className='grid gap-5 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <label className={labelCls} htmlFor='contact-firstname'>
              First name
            </label>
            <input
              id='contact-firstname'
              name='firstname'
              type='text'
              autoComplete='given-name'
              required
              disabled={disabled}
              value={firstname}
              onChange={e => setFirstname(e.target.value)}
              className={fieldCls}
            />
          </div>
          <div className='space-y-1.5'>
            <label className={labelCls} htmlFor='contact-lastname'>
              Last name
            </label>
            <input
              id='contact-lastname'
              name='lastname'
              type='text'
              autoComplete='family-name'
              required
              disabled={disabled}
              value={lastname}
              onChange={e => setLastname(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>

        <div className='space-y-1.5'>
          <label className={labelCls} htmlFor='contact-subject'>
            Subject
          </label>
          <input
            id='contact-subject'
            name='subject'
            type='text'
            required
            disabled={disabled}
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className={fieldCls}
            placeholder='What would you like to discuss?'
          />
        </div>

        <div className='space-y-1.5'>
          <label className={labelCls} htmlFor='contact-message'>
            Message
          </label>
          <textarea
            id='contact-message'
            name='message'
            required
            disabled={disabled}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={6}
            className={cx(fieldCls, 'min-h-[160px] resize-y')}
            placeholder='Your message…'
          />
        </div>

        <div className='space-y-1.5'>
          <label className={labelCls} htmlFor='contact-heard-about'>
            How did you hear about me?
          </label>
          <input
            id='contact-heard-about'
            name='heardAbout'
            type='text'
            disabled={disabled}
            value={heardAbout}
            onChange={e => setHeardAbout(e.target.value)}
            className={fieldCls}
            // A literal ellipsis, not `&hellip;`. JSX does not decode entities inside an
            // attribute string, so the escape would render as six visible characters -
            // which is why the message field above already uses the character itself.
            placeholder='A blog post, a friend, a search… (optional)'
            maxLength={200}
          />
          {/*
            No `required`, and the placeholder says "optional" rather than a separate hint
            line. The other four labels carry no hint, so one that did would read as a
            warning about this field instead of permission to skip it.

            `maxLength` mirrors the handler's own cap, which rejects with a 400 naming the
            field. Both exist: the attribute stops an accident, the server stops a `curl`.
          */}
        </div>

        {status.kind === 'error' ? (
          <p
            role='alert'
            className='rounded-lg border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-900'
          >
            {status.message}
          </p>
        ) : null}

        {status.kind === 'success' ? (
          <p
            role='status'
            className='rounded-lg border border-emerald-200/90 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950'
          >
            Thanks - your message was sent. I will get back to you when I can.
          </p>
        ) : null}

        <div className='flex flex-wrap items-center gap-4 pt-1'>
          <button
            type='submit'
            disabled={disabled}
            className={cx(
              'inline-flex min-h-[44px] items-center justify-center rounded-full border border-pp-line bg-pp-text px-8 py-2.5 text-sm font-semibold text-[var(--pp-bg)] shadow-panel',
              'motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-0.5',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
              disabled && 'cursor-not-allowed opacity-60 motion-safe:hover:translate-y-0',
            )}
          >
            {status.kind === 'loading' ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </form>
    </EditorialPanel>
  )
}
