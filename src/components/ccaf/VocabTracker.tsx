'use client'

import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Shuffle } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { cx, eyebrowCls, fieldCls, secondaryBtnCls } from '@/components/ccaf/ccaf-ui'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import TabNav from '@/components/settings/TabNav'
import { VOCAB_CATEGORIES, VOCAB_DECK, type VocabWord } from '@/lib/ccaf/vocab-data'

/**
 * Keyed by term, and `-v2` because the first version keyed by deck position.
 *
 * Position was never a safe key: regrouping the deck under the exam's own domains moved
 * every word, so a stored `{"1": 2}` would have gone on meaning "word #1 is mastered"
 * while word #1 became something else entirely - progress silently pointing at the wrong
 * words. The term is the one identifier that survives any regrouping. The old key is left
 * unread rather than migrated; it belongs to an ordering that no longer exists.
 */
const MASTERY_STORAGE_KEY = 'portfolio:ccaf:vocab-mastery-v2'

type Level = 0 | 1 | 2
type MasteryMap = Record<string, Level>

const LEVEL_LABELS: [string, string, string] = ['Chưa học', 'Đang học', 'Đã thuộc']
const LEVEL_DOT: [string, string, string] = ['bg-pp-muted/50', 'bg-pp-orange', 'bg-pp-green']
const LEVEL_SEL: [string, string, string] = [
  'border-pp-muted/50 bg-pp-muted/10 text-pp-text',
  'border-pp-orange/50 bg-pp-orange/10 text-pp-orange',
  'border-pp-green/50 bg-pp-green/10 text-pp-green',
]
const LEVEL_EDGE: [string, string, string] = [
  'border-l-pp-muted/40',
  'border-l-pp-orange',
  'border-l-pp-green',
]

/**
 * The same stripe seen from the card's other side.
 *
 * The mark is one physical edge of one card, not a decoration each face owns: turn the card
 * over and that edge is now on your right. Repeating it on the left of the back face was the
 * tell that the flip was two panels swapping rather than one card turning.
 */
const LEVEL_EDGE_BACK: [string, string, string] = [
  'border-r-pp-muted/40',
  'border-r-pp-orange',
  'border-r-pp-green',
]

function readStoredMastery(): MasteryMap {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MASTERY_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => v === 0 || v === 1 || v === 2
      )
    ) as MasteryMap
  } catch {
    return {}
  }
}

/** Per-word mastery (0 new / 1 learning / 2 mastered), same shape as `useRailWidth`. */
function useVocabMastery() {
  const [mastery, setMastery] = useState<MasteryMap>(readStoredMastery)

  useEffect(() => {
    try {
      window.localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(mastery))
    } catch {
      // A blocked or full storage quota costs the progress, nothing more.
    }
  }, [mastery])

  const setLevel = useCallback((term: string, level: Level) => {
    setMastery(prev => (prev[term] === level ? prev : { ...prev, [term]: level }))
  }, [])

  return { mastery, setLevel }
}

const WORD_BY_ORDER = new Map(VOCAB_DECK.map(word => [word.order, word]))

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** True while focus is in a text field, where the study shortcuts must stay out of the way. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  )
}

/**
 * `/admin/ccaf/vocab` - study the exam glossary as flip cards, or browse it as a grid.
 *
 * The deck lives in `lib/ccaf/vocab-data.ts` as plain hardcoded data, not a document: the
 * content only grows when a new exam attempt surfaces new terms, which is a code change
 * (append a group), not something that needs an editing form. Only per-word mastery is
 * stateful, and it stays in `localStorage` rather than the database - it is study scratch,
 * not portfolio content, and has no reason to sync across devices.
 *
 * ## Why one framed app instead of a scrolling page
 *
 * Everything lives inside a single panel sized to the viewport, split into a filter rail
 * and a content column that scroll independently. The page itself never scrolls, so the
 * two controls used constantly mid-session - the search box and the category list - stay
 * on screen no matter how far into a 290-word deck you are. The earlier vertical stack put
 * them above the cards, which meant scrolling back up to change a filter and losing your
 * place in the list to do it.
 */
export default function VocabTracker() {
  const { mastery, setLevel } = useVocabMastery()
  const [tab, setTab] = useState<'study' | 'browse'>('study')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyUnmastered, setOnlyUnmastered] = useState(false)
  const [deckOrder, setDeckOrder] = useState<number[]>(() => VOCAB_DECK.map(w => w.order))
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [openRows, setOpenRows] = useState<Set<number>>(() => new Set())

  const filteredWords = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deckOrder
      .map(order => WORD_BY_ORDER.get(order))
      .filter((w): w is VocabWord => {
        if (!w) return false
        if (selectedCat && w.cat !== selectedCat) return false
        if (q && !`${w.term} ${w.vi} ${w.ex} ${w.cat}`.toLowerCase().includes(q)) return false
        return true
      })
  }, [deckOrder, selectedCat, search])

  const pool = useMemo(
    () => (onlyUnmastered ? filteredWords.filter(w => (mastery[w.term] ?? 0) < 2) : filteredWords),
    [filteredWords, onlyUnmastered, mastery]
  )

  // Adjusted during render rather than in an effect - React's documented pattern for
  // resetting state off a derived-value change, without the extra render an effect would
  // cost. A changed filter jumps back to card 1; a pool that merely shrank (marking the
  // last unmastered card in view) clamps in place instead of resetting.
  const filterKey = `${selectedCat ?? ''}|${search}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  const [prevPoolLength, setPrevPoolLength] = useState(pool.length)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPrevPoolLength(pool.length)
    if (idx !== 0) setIdx(0)
    if (flipped) setFlipped(false)
  } else if (pool.length !== prevPoolLength) {
    setPrevPoolLength(pool.length)
    const clamped = Math.max(0, pool.length - 1)
    if (idx > clamped) setIdx(clamped)
  }

  const overall = useMemo(() => {
    let mastered = 0
    let learning = 0
    for (const w of VOCAB_DECK) {
      const level = mastery[w.term] ?? 0
      if (level === 2) mastered++
      else if (level === 1) learning++
    }
    return { total: VOCAB_DECK.length, mastered, learning }
  }, [mastery])

  const goNext = useCallback(() => {
    setIdx(i => Math.min(i + 1, Math.max(0, pool.length - 1)))
    setFlipped(false)
  }, [pool.length])

  const goPrev = useCallback(() => {
    setIdx(i => Math.max(i - 1, 0))
    setFlipped(false)
  }, [])

  const shuffle = useCallback(() => {
    setDeckOrder(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    })
    setIdx(0)
    setFlipped(false)
  }, [])

  const current = pool[idx]

  useEffect(() => {
    if (tab !== 'study') return
    function onKey(e: KeyboardEvent) {
      // The search box is always on screen in the rail now, so typing "3 nguồn" into it
      // must not mark the card behind it as mastered.
      if (isTypingTarget(e.target)) return
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === ' ') {
        e.preventDefault()
        setFlipped(f => !f)
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        if (current) setLevel(current.term, (Number(e.key) - 1) as Level)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tab, current, goNext, goPrev, setLevel])

  const masteredPct = overall.total ? (overall.mastered / overall.total) * 100 : 0
  const learningPct = overall.total ? (overall.learning / overall.total) * 100 : 0

  return (
    <EditorialPanel className='flex h-full min-h-0 flex-col overflow-hidden lg:flex-row'>
      {/* Filter rail - fixed on lg+, its category list scrolling on its own. */}
      <aside className='flex shrink-0 flex-col border-b border-pp-line lg:w-[19.5rem] lg:border-b-0 lg:border-r'>
        <div className='space-y-4 p-5'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <p className={eyebrowCls}>CCA-F</p>
              <h1 className='mt-1.5 font-display text-2xl font-semibold tracking-tight text-pp-text'>
                Từ vựng
              </h1>
            </div>
            {/* Stands in for the `AdminHomeLink` pill this board hides, so the frame can
                own the full viewport without the page losing its only way out. */}
            <Link
              href='/admin'
              aria-label='All boards'
              title='All boards'
              className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-pp-line bg-pp-panel-strong text-pp-muted no-underline transition hover:text-pp-text'
            >
              <LayoutGrid aria-hidden size={14} />
            </Link>
          </div>

          <div>
            <div className='flex items-baseline justify-between'>
              <span className='font-display text-xl font-bold text-pp-text'>
                {Math.round(masteredPct)}%
              </span>
              <span className='text-[11px] text-pp-muted'>
                {overall.mastered}/{overall.total} đã thuộc
              </span>
            </div>
            <div className='mt-2 flex h-2 overflow-hidden rounded-full bg-pp-line'>
              <div className='h-full bg-pp-green' style={{ width: `${masteredPct}%` }} />
              <div className='h-full bg-pp-orange' style={{ width: `${learningPct}%` }} />
            </div>
            <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-pp-muted'>
              {LEVEL_LABELS.map((label, level) => (
                <span key={label} className='flex items-center gap-1.5'>
                  <i className={cx('h-1.5 w-1.5 rounded-full', LEVEL_DOT[level])} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <input
            type='text'
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Tìm từ hoặc nghĩa...'
            className={fieldCls}
          />
        </div>

        {/* Horizontal strip on small screens, a vertical list once there is a rail. */}
        <div className='flex min-h-0 gap-2 overflow-x-auto px-5 pb-5 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto'>
          <CategoryButton
            label='Tất cả'
            count={VOCAB_DECK.length}
            active={selectedCat === null}
            onClick={() => setSelectedCat(null)}
          />
          {VOCAB_CATEGORIES.map(cat => (
            <CategoryButton
              key={cat}
              label={cat}
              count={VOCAB_DECK.filter(w => w.cat === cat).length}
              active={selectedCat === cat}
              onClick={() => setSelectedCat(selectedCat === cat ? null : cat)}
            />
          ))}
        </div>
      </aside>

      {/* Content column - toolbar pinned, only the panel below it scrolls. */}
      <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b border-pp-line px-5 py-3'>
          {/* `TabNav` bakes in a bottom margin for its usual stacked position; this toolbar
              supplies its own spacing, so the margin is dropped rather than doubled. */}
          <div className='[&>[role=tablist]]:mb-0'>
            <TabNav
              tabs={[
                { id: 'study', label: 'Học theo thẻ' },
                { id: 'browse', label: 'Duyệt danh sách' },
              ]}
              activeId={tab}
              onChange={id => setTab(id as 'study' | 'browse')}
              ariaLabel='Vocab view'
            />
          </div>

          <div className='flex items-center gap-3 text-[11px] text-pp-muted'>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={onlyUnmastered}
                onChange={() => setOnlyUnmastered(v => !v)}
                className='h-3.5 w-3.5 accent-pp-blue'
              />
              Chỉ từ chưa thuộc
            </label>
            <span className='font-mono'>
              {pool.length} / {VOCAB_DECK.length} từ
            </span>
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto p-5'>
          {tab === 'study' ? (
            <StudyView
              word={current}
              position={pool.length ? idx + 1 : 0}
              total={pool.length}
              level={current ? mastery[current.term] ?? 0 : 0}
              flipped={flipped}
              onFlip={() => setFlipped(f => !f)}
              onPrev={goPrev}
              onNext={goNext}
              onShuffle={shuffle}
              onSetLevel={level => current && setLevel(current.term, level)}
            />
          ) : (
            <BrowseView
              words={filteredWords}
              cats={selectedCat ? [selectedCat] : VOCAB_CATEGORIES}
              mastery={mastery}
              onSetLevel={setLevel}
              openRows={openRows}
              onToggleRow={order => setOpenRows(prev => toggleInSet(prev, order))}
            />
          )}
        </div>
      </section>
    </EditorialPanel>
  )
}

function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cx(
        'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold transition lg:w-full lg:justify-between lg:whitespace-normal lg:rounded-xl lg:px-3 lg:py-2 lg:text-left',
        active
          ? 'border-pp-text bg-pp-text text-white'
          : 'border-pp-line bg-pp-panel-strong text-pp-muted hover:text-pp-text'
      )}
    >
      <span className='lg:leading-snug'>{label}</span>
      <span className={cx('font-mono text-[10px]', active ? 'text-white/70' : 'text-pp-muted/70')}>
        {count}
      </span>
    </button>
  )
}

function StudyView({
  word,
  position,
  total,
  level,
  flipped,
  onFlip,
  onPrev,
  onNext,
  onShuffle,
  onSetLevel,
}: {
  word: VocabWord | undefined
  position: number
  total: number
  level: Level
  flipped: boolean
  onFlip: () => void
  onPrev: () => void
  onNext: () => void
  onShuffle: () => void
  onSetLevel: (level: Level) => void
}) {
  if (!word) {
    return (
      <div className='flex h-full min-h-[16rem] items-center justify-center rounded-panel border border-dashed border-pp-line text-center text-sm text-pp-muted'>
        <p>
          Không còn từ nào trong bộ lọc hiện tại.
          <br />
          Thử bỏ bớt điều kiện lọc hoặc tắt &quot;chỉ từ chưa thuộc&quot;.
        </p>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-5 xl:flex-row'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col gap-4'>
        {/*
          The flip is a horizontal squash-and-open, not a `rotateY`.

          A true 3D rotation was tried first and had to go: under `perspective` the turning
          card projects wider than its own layout box, and this card lives inside the scroll
          container, so every flip briefly overflowed it and the content scrollbar flashed in
          and out. Scaling only ever shrinks, so the card can never outgrow its box and the
          scrollbar never appears.

          The two faces are stacked and swap by delay rather than by a timer in state: the
          outgoing one collapses immediately, the incoming one waits the same 180ms before
          opening, which is what makes it read as one card turning instead of two fading.
        */}
        <div
          role='button'
          tabIndex={0}
          aria-pressed={flipped}
          onClick={onFlip}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onFlip()
            }
          }}
          className='relative min-h-[20rem] flex-1 cursor-pointer select-none rounded-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pp-blue'
        >
          <CardFace level={level} word={word} hidden={flipped}>
            <div className='flex flex-1 flex-col items-center justify-center gap-2 text-center'>
              <div className='font-display text-3xl font-semibold text-pp-text sm:text-4xl'>
                {word.term}
              </div>
              <div className='text-sm italic text-pp-muted'>{word.pos}</div>
              <p className='mt-3 text-[11px] uppercase tracking-[0.14em] text-pp-muted/70'>
                Ấn để xem nghĩa
              </p>
            </div>
          </CardFace>

          <CardFace level={level} word={word} hidden={!flipped} back>
            <div className='flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-y-auto py-4'>
              <div className='text-center'>
                <div className='font-display text-2xl font-semibold text-pp-green'>{word.vi}</div>
                <div className='mt-1 text-xs italic text-pp-muted'>
                  {word.term} · {word.pos}
                </div>
              </div>
              <div className='rounded-xl border border-pp-line text-center bg-pp-panel/70 p-4 text-sm leading-relaxed text-pp-muted'>
                {word.ex}
                {word.exVi ? (
                  <div className='mt-2 border-t border-dashed border-pp-line pt-2 text-xs italic text-pp-blue'>
                    {word.exVi}
                  </div>
                ) : null}
              </div>
            </div>
          </CardFace>
        </div>

        <div className='flex flex-wrap items-center justify-center gap-2'>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={onPrev}
            disabled={position <= 1}
          >
            <ChevronLeft aria-hidden size={15} className='mr-1' />
            Trước
          </button>
          <button type='button' className={secondaryBtnCls} onClick={onFlip}>
            Lật thẻ
          </button>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={onNext}
            disabled={position >= total}
          >
            Sau
            <ChevronRight aria-hidden size={15} className='ml-1' />
          </button>
          <button type='button' className={secondaryBtnCls} onClick={onShuffle}>
            <Shuffle aria-hidden size={14} className='mr-1.5' />
            Xáo bài
          </button>
        </div>
      </div>

      {/* The card's sidecar: position, marking, shortcuts - always reachable without a flip. */}
      <aside className='flex shrink-0 flex-col gap-4 rounded-panel border border-pp-line bg-pp-panel/60 p-4 xl:w-56'>
        <div>
          <p className={eyebrowCls}>Vị trí</p>
          <p className='mt-1 font-mono text-sm text-pp-text'>
            {position} / {total}
          </p>
        </div>

        <div>
          <p className={eyebrowCls}>Đánh dấu</p>
          <div className='mt-2 grid grid-cols-3 gap-2 xl:grid-cols-1'>
            {([0, 1, 2] as Level[]).map(l => (
              <button
                key={l}
                type='button'
                onClick={() => onSetLevel(l)}
                className={cx(
                  'flex items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs font-semibold transition xl:justify-start',
                  l === level
                    ? LEVEL_SEL[l]
                    : 'border-pp-line bg-pp-panel-strong text-pp-muted hover:text-pp-text'
                )}
              >
                <i className={cx('h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[l])} />
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
        </div>

        <div className='hidden xl:block'>
          <p className={eyebrowCls}>Phím tắt</p>
          <dl className='mt-2 space-y-1 text-[11px] text-pp-muted'>
            <div className='flex justify-between gap-2'>
              <dt>Lật thẻ</dt>
              <dd className='font-mono'>Space</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt>Chuyển thẻ</dt>
              <dd className='font-mono'>← →</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt>Đánh dấu</dt>
              <dd className='font-mono'>1 2 3</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  )
}

/**
 * One side of the flip card: the shared panel chrome plus whichever body it was handed.
 *
 * Both faces are stacked in the same box; `hidden` collapses this one to nothing along its
 * own centre line. The delay is asymmetric on purpose - a face closes at once but opens only
 * after the other has finished closing, so the two never overlap mid-flip.
 */
function CardFace({
  word,
  level,
  hidden,
  back,
  children,
}: {
  word: VocabWord
  level: Level
  hidden: boolean
  /** Renders the mastery stripe on the right, where turning the card puts that edge. */
  back?: boolean
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={hidden}
      className={cx(
        'absolute inset-0 flex flex-col overflow-hidden rounded-panel border border-pp-line bg-pp-panel-strong p-6 shadow-panel',
        'motion-safe:transition-transform motion-safe:duration-[180ms] motion-safe:ease-out',
        back ? cx('border-r-4', LEVEL_EDGE_BACK[level]) : cx('border-l-4', LEVEL_EDGE[level]),
        hidden ? 'scale-x-0 delay-0' : 'scale-x-100 motion-safe:delay-[180ms]'
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <span className='font-mono text-[11px] text-pp-muted'>#{word.order}</span>
        <span className='max-w-[60%] text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-pp-muted'>
          {word.cat}
        </span>
      </div>
      {children}
    </div>
  )
}

function BrowseView({
  words,
  cats,
  mastery,
  onSetLevel,
  openRows,
  onToggleRow,
}: {
  words: VocabWord[]
  cats: string[]
  mastery: MasteryMap
  onSetLevel: (term: string, level: Level) => void
  openRows: Set<number>
  onToggleRow: (order: number) => void
}) {
  const groups = cats
    .map(cat => ({ cat, items: words.filter(w => w.cat === cat) }))
    .filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div className='flex h-full min-h-[16rem] items-center justify-center rounded-panel border border-dashed border-pp-line text-sm text-pp-muted'>
        Không tìm thấy từ nào khớp bộ lọc hiện tại.
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {groups.map(({ cat, items }) => {
        const total = VOCAB_DECK.filter(w => w.cat === cat).length
        const masteredCount = VOCAB_DECK.filter(
          w => w.cat === cat && (mastery[w.term] ?? 0) === 2
        ).length

        return (
          <section key={cat}>
            <div className='mb-3 flex items-center gap-3'>
              <h2 className='text-sm font-semibold text-pp-text'>{cat}</h2>
              <span className='h-px flex-1 bg-pp-line' />
              <span className='shrink-0 font-mono text-[11px] text-pp-muted'>
                {masteredCount}/{total}
              </span>
            </div>

            {/* `items-start` because grid rows stretch by default: without it, expanding
                one card grew every other card in its row to match, leaving them padded out
                with empty space around a single line of text. */}
            <div className='grid items-start gap-3 sm:grid-cols-2 2xl:grid-cols-3'>
              {items.map(word => (
                <VocabCard
                  key={word.order}
                  word={word}
                  level={mastery[word.term] ?? 0}
                  open={openRows.has(word.order)}
                  onToggle={() => onToggleRow(word.order)}
                  onSetLevel={level => onSetLevel(word.term, level)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function VocabCard({
  word,
  level,
  open,
  onToggle,
  onSetLevel,
}: {
  word: VocabWord
  level: Level
  open: boolean
  onToggle: () => void
  onSetLevel: (level: Level) => void
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-l-4 border-pp-line bg-pp-panel-strong/70 p-3 transition',
        LEVEL_EDGE[level]
      )}
    >
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-start justify-between gap-2 text-left'
      >
        <span className='min-w-0'>
          <span className='block text-sm font-semibold text-pp-text'>{word.term}</span>
          <span className='mt-0.5 block text-[11px] italic text-pp-muted'>
            #{word.order} · {word.pos}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={14}
          className={cx('mt-0.5 shrink-0 text-pp-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className='mt-3 space-y-2'>
          <div className='text-sm font-semibold text-pp-green'>{word.vi}</div>
          <div className='rounded-lg border border-pp-line bg-pp-panel/60 p-2.5 text-[11px] leading-relaxed text-pp-muted'>
            {word.ex}
            {word.exVi ? (
              <div className='mt-1.5 border-t border-dashed border-pp-line pt-1.5 italic text-pp-blue'>
                {word.exVi}
              </div>
            ) : null}
          </div>
          <div className='grid grid-cols-3 gap-1.5'>
            {([0, 1, 2] as Level[]).map(l => (
              <button
                key={l}
                type='button'
                onClick={() => onSetLevel(l)}
                className={cx(
                  'rounded-lg border px-1.5 py-1.5 text-[10px] font-semibold transition',
                  l === level
                    ? LEVEL_SEL[l]
                    : 'border-pp-line bg-pp-panel-strong text-pp-muted hover:text-pp-text'
                )}
              >
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
