import React from 'react'

export default function SettingLoading() {
  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='relative mx-auto max-w-editorial px-gutter py-10'>
        <div className='rounded-[1.8rem] border border-pp-line bg-white/78 p-6 shadow-panel backdrop-blur-md'>
          <h2 className='font-display text-2xl font-semibold tracking-tight text-pp-text'>
            Loading profile...
          </h2>
          <p className='mt-2 text-sm leading-relaxed text-pp-muted'>Preparing your editorial settings view.</p>
        </div>
      </div>
    </div>
  )
}
