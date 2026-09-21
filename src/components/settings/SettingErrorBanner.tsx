import React from 'react'

export default function SettingErrorBanner({
  message,
}: {
  message: string | null
}) {
  if (!message) return null
  return (
    <div className="mb-6 rounded-[1.35rem] border border-[rgba(163,49,47,0.16)] bg-[rgba(211,108,105,0.1)] px-4 py-3 text-sm font-medium text-[#7f2f2f] shadow-[0_12px_28px_rgba(127,47,47,0.08)]">
      {message}
    </div>
  )
}
