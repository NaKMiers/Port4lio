'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  HiHome,
  HiUser,
  HiViewColumns,
  HiRectangleGroup,
  HiChatBubbleBottomCenterText,
  HiEnvelope,
} from 'react-icons/hi2'

// One-page public nav: canonical links use `/?section=` (legacy paths still redirect to these).
const navData = [
  { name: 'home', href: '/', icon: <HiHome /> },
  { name: 'about', href: '/?section=about', icon: <HiUser /> },
  { name: 'services', href: '/?section=services', icon: <HiRectangleGroup /> },
  { name: 'work', href: '/?section=work', icon: <HiViewColumns /> },
  {
    name: 'testimonials',
    href: '/?section=testimonials',
    icon: <HiChatBubbleBottomCenterText />,
  },
  {
    name: 'contact',
    href: '/?section=contact',
    icon: <HiEnvelope />,
  },
]

const Nav = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function isNavActive(segment: string) {
    const section = searchParams.get('section')
    if (segment === 'home') return pathname === '/' && section == null
    return pathname === '/' && section === segment
  }

  return (
    <nav className="fixed bottom-0 top-0 z-50 mt-auto flex h-max w-full flex-col items-center gap-y-4 xl:right-[2%] xl:h-screen xl:w-16 xl:max-w-md xl:justify-center">
      {/* inner */}
      <div className="flex h-[60px] w-full items-center justify-between gap-y-10 bg-white/10 px-4 py-8 text-2xl backdrop-blur-sm md:px-40 xl:h-max xl:flex-col xl:justify-center xl:rounded-full xl:px-0 xl:text-xl">
        {navData.map((link, index) => (
          <Link
            className={`${
              isNavActive(link.name) ? 'text-yellow-400' : ''
            } group relative flex items-center transition-all duration-300 hover:text-yellow-200`}
            key={index}
            href={link.href}
          >
            {/* tooltip */}
            <div className="absolute right-0 hidden pr-14 xl:group-hover:flex">
              <div className="relative flex items-center rounded-[3px] bg-white p-[6px] text-primary">
                <div className="text-[12px] font-semibold capitalize leading-none">
                  {link.name}
                </div>
                <div className="absolute -right-2 border-y-[6px] border-l-8 border-r-0 border-solid border-y-transparent border-l-white"></div>
              </div>
            </div>

            {/* icon */}
            <div>{link.icon}</div>
          </Link>
        ))}
      </div>
    </nav>
  )
}

export default Nav
