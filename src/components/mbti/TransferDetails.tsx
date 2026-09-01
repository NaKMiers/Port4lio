'use client'

import { useCallback, useEffect, useState } from 'react'

import { bankNameFromBin } from '@/lib/banks'
import { formatPrice } from '@/lib/mbti/pricing'

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

export type TransferDetailsCopy = {
  title: string
  bank: string
  accountNumber: string
  accountName: string
  amount: string
  transferNote: string
  transferWarning: string
  copy: string
  copied: string
}

export type TransferDetailsProps = {
  amount: number
  bin?: string
  accountNumber?: string
  accountName?: string
  /**
   * PayOS's own memo string, e.g. `CSGFGZX5EW6 MBTI123`. NOT our order code - PayOS
   * prefixes its own reference, and a transfer carrying anything else cannot be matched
   * automatically. Always rendered verbatim.
   */
  transferDescription?: string
  copy: TransferDetailsCopy
}

/**
 * Bank transfer details rendered on our own page, so someone who cannot scan the QR never
 * has to leave the site for PayOS's hosted checkout.
 *
 * Ported from AnphaShop's component onto this site's editorial tokens.
 */
export default function TransferDetails({
  amount,
  bin,
  accountNumber,
  accountName,
  transferDescription,
  copy,
}: TransferDetailsProps) {
  const [copied, setCopied] = useState<string>('')

  const bankName = bankNameFromBin(bin)

  const handleCopy = useCallback((value: string, key: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(key)
  }, [])

  // Clear the badge so it reads as a transient confirmation rather than a state.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(''), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  if (!accountNumber) return null

  const rows: { key: string; label: string; value: string; copyable: boolean; strong?: boolean }[] = [
    // Omitted entirely when the BIN is unknown: showing the WRONG bank next to an account
    // number is worse than showing none, because people use it to sanity-check the payee.
    ...(bankName ? [{ key: 'bank', label: copy.bank, value: bankName, copyable: false }] : []),
    { key: 'account', label: copy.accountNumber, value: accountNumber, copyable: true },
    ...(accountName
      ? [{ key: 'name', label: copy.accountName, value: accountName, copyable: false }]
      : []),
    { key: 'amount', label: copy.amount, value: formatPrice(amount), copyable: true },
    ...(transferDescription
      ? [
          {
            key: 'note',
            label: copy.transferNote,
            value: transferDescription,
            copyable: true,
            strong: true,
          },
        ]
      : []),
  ]

  return (
    <div>
      <p className='font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted'>
        {copy.title}
      </p>

      <dl className='mt-3 divide-y divide-pp-line rounded-panel border border-pp-line bg-white/60'>
        {rows.map(row => (
          <div key={row.key} className='flex items-center justify-between gap-3 px-4 py-3'>
            <dt className='text-xs uppercase tracking-[0.12em] text-pp-muted'>{row.label}</dt>
            <dd className='flex min-w-0 items-center gap-2'>
              <span
                className={cx(
                  'truncate text-sm tabular-nums',
                  row.strong ? 'font-semibold text-pp-text' : 'text-pp-text'
                )}
              >
                {row.value}
              </span>
              {row.copyable && (
                <button
                  type='button'
                  onClick={() => handleCopy(row.value, row.key)}
                  className='shrink-0 rounded-full border border-pp-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-pp-muted transition hover:border-pp-text hover:text-pp-text'
                >
                  {copied === row.key ? copy.copied : copy.copy}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {transferDescription && (
        <p className='mt-3 flex gap-2.5 text-xs leading-relaxed text-pp-muted'>
          <span className='mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pp-orange' aria-hidden />
          {copy.transferWarning}
        </p>
      )}
    </div>
  )
}
