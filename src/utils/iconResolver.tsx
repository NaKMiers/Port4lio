import React from 'react'
import type { IconType } from 'react-icons'
import * as BsIcons from 'react-icons/bs'
import * as FaIcons from 'react-icons/fa'
import * as IoIcons from 'react-icons/io5'
import * as LuIcons from 'react-icons/lu'
import * as MdIcons from 'react-icons/md'
import * as RiIcons from 'react-icons/ri'
import * as SiIcons from 'react-icons/si'
import * as TbIcons from 'react-icons/tb'

type IconPackName = 'fa' | 'bs' | 'io' | 'lu' | 'md' | 'ri' | 'si' | 'tb'

const iconPacks: Record<IconPackName, Record<string, unknown>> = {
  fa: FaIcons as Record<string, unknown>,
  bs: BsIcons as Record<string, unknown>,
  io: IoIcons as Record<string, unknown>,
  lu: LuIcons as Record<string, unknown>,
  md: MdIcons as Record<string, unknown>,
  ri: RiIcons as Record<string, unknown>,
  si: SiIcons as Record<string, unknown>,
  tb: TbIcons as Record<string, unknown>,
}

export type IconCatalogItem = {
  code: string
  name: string
  Component: IconType
}

function isIconComponent(value: unknown): value is IconType {
  return typeof value === 'function'
}

const legacyAliases: Record<string, string> = {
  react: 'fa:FaReact',
  next: 'si:SiNextdotjs',
  nextjs: 'si:SiNextdotjs',
  node: 'fa:FaNodeJs',
  nodejs: 'fa:FaNodeJs',
  mongo: 'si:SiMongodb',
  mongodb: 'si:SiMongodb',
  typescript: 'si:SiTypescript',
  ts: 'si:SiTypescript',
  layout: 'tb:TbLayoutDashboard',
  zap: 'tb:TbBolt',
  sparkles: 'tb:TbSparkles',

  // Social aliases (back-compat for old `type` fields)
  github: 'fa:FaGithub',
  gh: 'fa:FaGithub',
  git: 'fa:FaGithub',
  linkedin: 'ri:RiLinkedinBoxFill',
  youtube: 'ri:RiYoutubeLine',
  yt: 'ri:RiYoutubeLine',
  instagram: 'ri:RiInstagramLine',
  ig: 'ri:RiInstagramLine',
  facebook: 'ri:RiFacebookLine',
  fb: 'ri:RiFacebookLine',
  pinterest: 'ri:RiPinterestLine',
  zalo: 'si:SiZalo',
  twitter: 'si:SiX',
  x: 'si:SiX',
  dribbble: 'si:SiDribbble',
  behance: 'si:SiBehance',
  telegram: 'si:SiTelegram',
  slack: 'si:SiSlack',
  medium: 'si:SiMedium',
  reddit: 'si:SiReddit',
  snapchat: 'si:SiSnapchat',
  tiktok: 'si:SiTiktok',
  threads: 'si:SiThreads',
  thread: 'si:SiThreads',
  mastodon: 'si:SiMastodon',
  devto: 'si:SiDevdotto',
  dev: 'si:SiDevdotto',
  email: 'md:MdOutlineAlternateEmail',
  mail: 'md:MdOutlineAlternateEmail',
  website: 'tb:TbWorld',
  web: 'tb:TbWorld',
  site: 'tb:TbWorld',
}

export function getIconCatalog(): IconCatalogItem[] {
  const items: IconCatalogItem[] = []

  ;(Object.keys(iconPacks) as IconPackName[]).forEach(pack => {
    Object.entries(iconPacks[pack]).forEach(([name, value]) => {
      if (!isIconComponent(value) || !name || !/^[A-Z]/.test(name)) return
      items.push({
        code: `${pack}:${name}`,
        name,
        Component: value,
      })
    })
  })

  return items
}

export function resolveIconCode(input?: string): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (raw.includes(':')) return raw
  return legacyAliases[raw.toLowerCase()] || null
}

export function resolveIconFromCode(
  input: string | undefined,
  size = 20,
  className?: string
): React.ReactNode {
  const code = resolveIconCode(input)
  if (!code)
    return (
      <BsIcons.BsCursor
        size={size}
        className={className}
      />
    )

  const [pack, iconName] = code.split(':')
  const selectedPack = iconPacks[pack as IconPackName]
  const Icon = selectedPack?.[iconName]
  if (!isIconComponent(Icon))
    return (
      <BsIcons.BsCursor
        size={size}
        className={className}
      />
    )

  return (
    <Icon
      size={size}
      className={className}
    />
  )
}
