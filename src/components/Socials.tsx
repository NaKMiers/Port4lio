'use client'

import { useApp } from '@/context/AppContext'
import Link from 'next/link'
import { resolveIconFromCode } from '@/utils/iconResolver'

const Socials = () => {
  const { profile } = useApp()
  const socials = (profile?.socials ?? []).filter(social =>
    social?.link?.trim()
  )

  return (
    <div className="flex items-center gap-x-5 text-xl">
      {socials.map(social => (
        <Link
          key={`${social.name}-${social.link}`}
          target="_blank"
          href={social.link}
          rel="noreferrer"
          className="transition-all duration-300 hover:text-accent"
          aria-label={social.name || social.link}
        >
          {social.icon ? resolveIconFromCode(social.icon, 24) : null}
        </Link>
      ))}
    </div>
  )
}

export default Socials
