'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export type ProjectCarouselSlide = {
  src: string
  alt: string
  caption?: string
}

type ProjectImageCarouselProps = {
  slides: ProjectCarouselSlide[]
  priority?: boolean
  aspectClassName?: string
  sizes: string
  className?: string
  chrome?: 'feature' | 'catalog'
}

function isLikelyCloudinary(url: string): boolean {
  return url.includes('res.cloudinary.com')
}

function CarouselImage({
  slide,
  priority,
  sizes,
}: {
  slide: ProjectCarouselSlide
  priority: boolean
  sizes: string
}) {
  if (isLikelyCloudinary(slide.src))
    return (
      <Image
        src={slide.src}
        alt={slide.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    )

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN URLs from profile
    <img
      src={slide.src}
      alt={slide.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

export function ProjectImageCarousel({
  slides,
  priority = false,
  aspectClassName = 'aspect-[16/10]',
  sizes,
  className,
  chrome = 'feature',
}: ProjectImageCarouselProps) {
  const safeSlides = useMemo(
    () => slides.filter(slide => slide.src.trim().length > 0),
    [slides]
  )
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (safeSlides.length <= 1) return
    const timer = window.setInterval(() => {
      setActiveIndex(current => (current + 1) % safeSlides.length)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [safeSlides.length])

  if (!safeSlides.length) return null

  const boundedIndex = activeIndex % safeSlides.length
  const slide = safeSlides[boundedIndex] ?? safeSlides[0]
  const showControls = safeSlides.length > 1
  const buttonCls =
    'inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-[rgba(17,17,17,0.28)] text-white backdrop-blur-md transition-colors hover:bg-[rgba(17,17,17,0.42)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80'

  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-[1.6rem] border border-pp-line/80 bg-pp-panel-strong shadow-[0_24px_55px_rgba(46,35,28,0.1)]',
        className
      )}
    >
      <div
        className={cx(
          'relative w-full overflow-hidden bg-pp-bg/35',
          aspectClassName
        )}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${slide.src}-${activeIndex}`}
            initial={{ opacity: 0.18, scale: 1.035 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.18, scale: 0.985 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <CarouselImage
              slide={slide}
              priority={priority && activeIndex === 0}
              sizes={sizes}
            />
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(15,15,15,0.02)_0%,rgba(15,15,15,0.0)_52%,rgba(15,15,15,0.36)_100%)]" />

        {slide.caption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="max-w-[28rem] rounded-2xl bg-[rgba(255,255,255,0.82)] px-3.5 py-2.5 text-sm font-medium leading-relaxed text-pp-text shadow-[0_12px_30px_rgba(17,17,17,0.12)] backdrop-blur-md">
              {slide.caption}
            </div>
          </div>
        ) : null}

        {showControls ? (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className="rounded-full bg-[rgba(255,255,255,0.82)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text shadow-[0_8px_18px_rgba(17,17,17,0.08)] backdrop-blur-md">
                {String(boundedIndex + 1).padStart(2, '0')} /{' '}
                {String(safeSlides.length).padStart(2, '0')}
              </span>
            </div>

            <div
              className={cx(
                'absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-between opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100',
                chrome === 'catalog' && 'inset-x-2'
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveIndex(
                    current =>
                      (current - 1 + safeSlides.length) % safeSlides.length
                  )
                }
                className={buttonCls}
                aria-label="Show previous project image"
              >
                <ChevronLeft
                  className="h-4 w-4"
                  aria-hidden
                />
              </button>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex(current => (current + 1) % safeSlides.length)
                }
                className={buttonCls}
                aria-label="Show next project image"
              >
                <ChevronRight
                  className="h-4 w-4"
                  aria-hidden
                />
              </button>
            </div>
          </>
        ) : null}
      </div>

      {showControls ? (
        <div className="bg-white/78 flex items-center justify-between gap-3 border-t border-pp-line/80 px-4 py-3 backdrop-blur-md">
          <div
            className="flex items-center gap-2"
            aria-label="Project image slides"
          >
            {safeSlides.map((item, index) => {
              const active = index === boundedIndex
              return (
                <button
                  key={`${item.src}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={cx(
                    'duration-250 h-2.5 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
                    active
                      ? 'w-9 bg-pp-text'
                      : 'w-2.5 bg-pp-line hover:bg-pp-muted/45'
                  )}
                  aria-label={`Show image ${index + 1}`}
                  aria-pressed={active}
                />
              )
            })}
          </div>

          <p className="text-xs font-medium text-pp-muted">
            Auto-slides every 5s
          </p>
        </div>
      ) : null}
    </div>
  )
}
