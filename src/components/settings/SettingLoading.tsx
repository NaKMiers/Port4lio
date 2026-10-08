import React from 'react'

import { AdminHubPill } from '@/components/admin/AdminHomeLink'

/**
 * The shared loading screen for every owner board.
 *
 * ## Why it takes props now, and why they have defaults
 *
 * The copy used to be hardcoded to "Loading profile..." / "Preparing your editorial settings
 * view.", which was accurate when the settings editor was the only board. It stopped being
 * accurate the moment it was not: `/admin/metrics` renders this component too, and was telling
 * the owner it was loading a profile while it loaded the funnel.
 *
 * Defaults, rather than making the props required: every existing call site is correct as
 * written or is the settings editor itself, so requiring them would be a mechanical edit to
 * three files to change the behaviour of two. The default is the settings copy because that
 * is the caller the words were written for, and the boards that need different words now say
 * so.
 *
 * `hubPill` is for `/admin/settings` only: `AdminHomeLink` hides on that route (its toolbar
 * carries the pill instead), so while the page loads it would otherwise have no way back.
 * Every other board still gets the pill from `AdminHomeLink`, and would show two.
 */
export default function SettingLoading({
  hubPill = false,
  title = 'Loading profile...',
  subtitle = 'Preparing your editorial settings view.',
}: {
  hubPill?: boolean
  title?: string
  subtitle?: string
} = {}) {
  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-10">
      {hubPill ? (
        <div className="mb-6">
          <AdminHubPill />
        </div>
      ) : null}
      <div className="bg-white/78 rounded-[1.8rem] border border-pp-line p-6 shadow-panel backdrop-blur-md">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-pp-text">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-pp-muted">{subtitle}</p>
      </div>
    </div>
  )
}
