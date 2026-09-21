'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import Chevron from '@/components/mbti/Chevron'
import PaymentCountdown from '@/components/mbti/PaymentCountdown'
import TransferDetails, {
  type TransferDetailsCopy,
} from '@/components/mbti/TransferDetails'
import type { Locale } from '@/lib/i18n'
import { CERTIFICATE_NAME_MAX } from '@/lib/iq/pricing'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

/** The webhook usually lands first; this only has to cover the case where it does not. */
const POLL_INTERVAL_MS = 3_000

type Payment = {
  orderCode: number
  amount: number
  /** Absolute ISO timestamp when the PayOS link stops being payable. */
  expiresAt: string
  /** A PNG data URI, rendered server-side from PayOS's VietQR payload. */
  qrDataUri?: string | null
  bin?: string
  accountNumber?: string
  accountName?: string
  transferDescription?: string
  checkoutUrl?: string
}

export type TestPaywallCopy = {
  title: string
  /** Contains `{price}`. */
  lead: string
  emailLabel: string
  emailPlaceholder: string
  emailHint: string
  payButton: string
  preparing: string
  scanTitle: string
  scanLead: string
  waiting: string
  done: string
  cancelled: string
  expiresIn: string
  expired: string
  retry: string
  /** Contains `{email}`. */
  deliveryNote: string
  invalidEmail: string
  rateLimited: string
  genericError: string
  transfer: TransferDetailsCopy
  /** Only when `withName` is set. IQ collects the certificate name at checkout. */
  nameLabel?: string
  namePlaceholder?: string
  nameHint?: string
  invalidName?: string
}

/**
 * Contact capture, then on-site payment. Shared by MBTI and IQ.
 *
 * ```
 *   email (+ name for IQ) ──▶ POST <endpoint> ──▶ QR + transfer details
 *                                                      │
 *                          GET /api/payos/status/:code │ every 3s
 *                                                      ▼
 *                                            paid ──▶ router.refresh()
 * ```
 *
 * The polling is a fallback, not the primary path - the PayOS webhook normally settles the
 * payment server-side within a second or two. It exists because local development has no
 * public URL for PayOS to reach, and because a dropped webhook must not leave someone who
 * has paid staring at a payment screen.
 *
 * On success this calls `router.refresh()` rather than pushing a route: both result pages
 * are already `force-dynamic`, so refreshing re-runs the server component, which now sees
 * `attempt.paid` and renders the full result in place.
 *
 * ## One component, two products
 *
 * Generalised out of MBTI's `ResultPaywall` when IQ moved to the same model - result is the
 * paid artifact, certificate included. The QR rendering, the countdown, the status poller
 * and the webhook-fallback reasoning are all subtle enough that a second copy would have
 * drifted; `endpoint` and `withName` are the only things that actually differ.
 */
export default function TestPaywall({
  token,
  locale,
  price,
  endpoint,
  withName = false,
  copy,
}: {
  token: string
  locale: Locale
  /** Pre-formatted server-side so the client never reimplements đồng formatting. */
  price: string
  /** `/api/mbti/checkout` or `/api/iq/checkout`. */
  endpoint: string
  /**
   * Collect a display name alongside the email.
   *
   * IQ includes a public certificate with the paid result, and that certificate carries a
   * name. Asking for it here rather than after payment means the buyer types it once, while
   * they are already filling in a form - a second prompt on the far side of a bank transfer
   * is a second place to abandon.
   */
  withName?: boolean
  copy: TestPaywallCopy
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [payment, setPayment] = useState<Payment | null>(null)
  const [status, setStatus] = useState<
    'idle' | 'creating' | 'waiting' | 'paid' | 'cancelled' | 'expired'
  >('idle')
  const [error, setError] = useState<string | null>(null)

  // Held in a ref so the polling effect does not re-subscribe on every tick.
  const orderCodeRef = useRef<number | null>(null)

  /**
   * Stable identity so the countdown's effect does not tear down and rebuild every second.
   *
   * Guarded on the current status rather than firing blindly: the countdown calls this on
   * every tick once it reaches zero, and a payment that landed in the final seconds must
   * not be dragged back out of `paid`.
   */
  const handleExpired = useCallback(() => {
    setStatus(current => (current === 'waiting' ? 'expired' : current))
  }, [])

  const startCheckout = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (status === 'creating' || status === 'waiting') return

      setError(null)
      setStatus('creating')

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `name` is only read by the IQ checkout; the MBTI route ignores unknown fields.
          body: JSON.stringify({
            token,
            email,
            locale,
            ...(withName ? { name } : {}),
          }),
        })

        if (response.status === 429) {
          setError(copy.rateLimited)
          setStatus('idle')
          return
        }

        const data = await response.json()

        // The attempt was already paid for - most likely a second tab, or a webhook that
        // landed while this form was open. Nothing to charge; just show the result.
        if (data?.alreadyPaid) {
          setStatus('paid')
          router.refresh()
          return
        }

        if (!response.ok) {
          // 400 covers both fields, so the message follows whichever one the server named.
          // Without this an invalid name would read "that email is not valid" and the buyer
          // would keep retyping a correct address.
          const badName =
            withName &&
            typeof data?.error === 'string' &&
            /name/i.test(data.error)
          setError(
            response.status === 400
              ? badName
                ? (copy.invalidName ?? copy.genericError)
                : copy.invalidEmail
              : (data?.error ?? copy.genericError)
          )
          setStatus('idle')
          return
        }

        orderCodeRef.current = data.orderCode
        setPayment(data as Payment)
        setStatus('waiting')
      } catch {
        setError(copy.genericError)
        setStatus('idle')
      }
    },
    [copy, email, endpoint, locale, name, router, status, token, withName]
  )

  useEffect(() => {
    if (status !== 'waiting') return

    let cancelled = false

    const timer = setInterval(async () => {
      const orderCode = orderCodeRef.current
      if (orderCode === null) return

      try {
        const response = await fetch(`/api/payos/status/${orderCode}`, {
          cache: 'no-store',
        })
        if (!response.ok || cancelled) return

        const data = await response.json()

        if (data.status === 'paid') {
          setStatus('paid')
          // The server component re-reads the attempt and renders the unlocked result.
          router.refresh()
        } else if (data.status === 'cancelled' || data.status === 'expired')
          setStatus('cancelled')
      } catch {
        // A dropped poll is not worth surfacing - the next tick retries, and the webhook is
        // still the primary path. Showing an error here would alarm someone mid-payment.
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [router, status])

  return (
    <section
      className="rounded-panel border border-pp-line bg-pp-panel p-6 shadow-panel backdrop-blur-md md:p-7"
      aria-labelledby="paywall-heading"
    >
      <h2
        id="paywall-heading"
        className="font-display text-xl font-semibold tracking-tight text-pp-text"
      >
        {copy.title}
      </h2>
      <p className="mt-2.5 text-sm leading-relaxed text-pp-muted">
        {copy.lead.replace('{price}', price)}
      </p>

      {status === 'idle' || status === 'creating' ? (
        <form
          onSubmit={startCheckout}
          className="mt-6"
        >
          <label
            htmlFor="paywall-email"
            className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted"
          >
            {copy.emailLabel}
          </label>
          <input
            id="paywall-email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder={copy.emailPlaceholder}
            className="mt-2 w-full rounded-full border border-pp-line bg-white/80 px-5 py-3 text-sm text-pp-text outline-none transition placeholder:text-pp-muted/70 focus:border-[rgba(123,109,255,0.6)] focus:ring-2 focus:ring-[rgba(123,109,255,0.25)]"
          />
          <p className="mt-2 text-xs text-pp-muted">{copy.emailHint}</p>

          {withName ? (
            <div className="mt-4">
              <label
                htmlFor="paywall-name"
                className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted"
              >
                {copy.nameLabel}
              </label>
              <input
                id="paywall-name"
                type="text"
                required
                autoComplete="name"
                maxLength={CERTIFICATE_NAME_MAX}
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder={copy.namePlaceholder}
                className="mt-2 w-full rounded-full border border-pp-line bg-white/80 px-5 py-3 text-sm text-pp-text outline-none transition placeholder:text-pp-muted/70 focus:border-[rgba(123,109,255,0.6)] focus:ring-2 focus:ring-[rgba(123,109,255,0.25)]"
              />
              <p className="mt-2 text-xs text-pp-muted">{copy.nameHint}</p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={status === 'creating'}
            className={cx(
              'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-pp-text px-6 py-3.5 font-display text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pp-bg)] shadow-[0_14px_28px_rgba(31,28,26,0.16)] transition sm:w-auto',
              status === 'creating'
                ? 'cursor-not-allowed opacity-70'
                : 'hover:-translate-y-0.5 motion-reduce:hover:translate-y-0'
            )}
          >
            {status === 'creating' ? copy.preparing : copy.payButton}
            {status === 'creating' ? null : <Chevron direction="right" />}
          </button>
        </form>
      ) : null}

      {status === 'waiting' && payment ? (
        <div className="mt-6">
          {/*
            QR left, manual transfer right. They are two ways to do the same thing, so
            side by side lets someone pick rather than scroll past the one they cannot
            use. Stacks below `lg` because the transfer table needs the full width to
            keep an account number on one line.
          */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-8">
            {payment.qrDataUri ? (
              <div className="flex flex-col">
                <p className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
                  {copy.scanTitle}
                </p>
                <p className="mt-1.5 text-sm text-pp-muted">{copy.scanLead}</p>
                {/*
                  A plain <img>, not next/image: this is an inline data URI, so there is no
                  URL for the optimiser to fetch and nothing for it to optimise. Decorative
                  alt because the transfer details beside it say the same thing in text.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={payment.qrDataUri}
                  alt=""
                  className="mt-3 h-auto w-full max-w-[260px] rounded-panel border border-pp-line bg-white p-2"
                />
                <div className="mt-3 max-w-[260px]">
                  <PaymentCountdown
                    expiresAt={payment.expiresAt}
                    label={copy.expiresIn}
                    onExpire={handleExpired}
                  />
                </div>
              </div>
            ) : null}

            <TransferDetails
              amount={payment.amount}
              bin={payment.bin}
              accountNumber={payment.accountNumber}
              accountName={payment.accountName}
              transferDescription={payment.transferDescription}
              copy={copy.transfer}
            />
          </div>

          <div className="mt-7 space-y-3 border-t border-pp-line pt-5">
            <p
              className="flex items-center gap-2.5 text-sm font-semibold text-pp-text"
              role="status"
              aria-live="polite"
            >
              <span
                className="pp-pulse-soft h-2 w-2 shrink-0 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))]"
                aria-hidden
              />
              {copy.waiting}
            </p>
            {/*
              Says both things that are true and one that matters: the page updates itself,
              and a copy is emailed. Naming the address back is also a last chance to catch
              a typo before the only receipt goes somewhere the buyer cannot read.
            */}
            <p className="text-sm leading-relaxed text-pp-muted">
              {copy.deliveryNote.replace('{email}', email)}
            </p>
          </div>
        </div>
      ) : null}

      {status === 'expired' ? (
        <div className="mt-6">
          <p
            className="text-sm text-[#c2410c]"
            role="alert"
          >
            {copy.expired}
          </p>
          <button
            type="button"
            onClick={() => {
              setPayment(null)
              setStatus('idle')
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-pp-line px-5 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.16em] text-pp-text transition hover:border-pp-text"
          >
            {copy.retry}
            <Chevron direction="right" />
          </button>
        </div>
      ) : null}

      {status === 'paid' ? (
        <p
          className="mt-6 text-sm font-semibold text-pp-text"
          role="status"
          aria-live="polite"
        >
          {copy.done}
        </p>
      ) : null}

      {status === 'cancelled' ? (
        <p
          className="mt-6 text-sm text-[#c2410c]"
          role="alert"
        >
          {copy.cancelled}
        </p>
      ) : null}

      {error ? (
        <p
          className="mt-4 text-sm text-[#c2410c]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
