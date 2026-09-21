'use client'

import type { ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { useRef } from 'react'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type RevealVariant = 'section' | 'dramatic' | 'soft'

type RevealOnScrollProps = {
  children: ReactNode
  className?: string
  delay?: number
  variant?: RevealVariant
}

const revealVariants: Record<
  RevealVariant,
  {
    hidden: { opacity: number; y: number; scale?: number; filter?: string }
    visible: { opacity: number; y: number; scale?: number; filter?: string }
  }
> = {
  section: {
    hidden: { opacity: 0, y: 54, scale: 0.985, filter: 'blur(10px)' },
    visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  },
  dramatic: {
    hidden: { opacity: 0, y: 72, scale: 0.96, filter: 'blur(18px)' },
    visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  },
  soft: {
    hidden: { opacity: 0, y: 26, scale: 0.995, filter: 'blur(6px)' },
    visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  },
}

export default function RevealOnScroll({
  children,
  className,
  delay = 0,
  variant = 'section',
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const isInView = useInView(ref, {
    once: true,
    amount: variant === 'dramatic' ? 0.06 : variant === 'soft' ? 0.1 : 0.12,
    margin: '0px 0px -10% 0px',
  })
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) return <div className={className}>{children}</div>

  return (
    <motion.div
      ref={ref}
      className={cx('will-change-transform', className)}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={revealVariants[variant]}
      transition={{
        duration: variant === 'dramatic' ? 0.92 : 0.72,
        delay,
        ease: [0.2, 0.9, 0.2, 1],
      }}
    >
      {children}
    </motion.div>
  )
}
