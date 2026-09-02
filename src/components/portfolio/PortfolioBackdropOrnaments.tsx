const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

const ornaments = [
  'left-[1%] top-[8rem] h-20 w-20 rounded-[1.8rem] bg-[linear-gradient(145deg,rgba(255,214,138,0.9),rgba(255,175,83,0.82))] pp-float pp-shadow-soft',
  'right-[3%] top-[5rem] h-32 w-32 rounded-[2rem] bg-[linear-gradient(155deg,rgba(255,255,255,0.9),rgba(235,232,248,0.9))] rotate-[-12deg] pp-sway pp-shadow-soft',
  'left-[-2rem] top-[14%] h-28 w-40 rounded-[1.9rem] border border-white/70 bg-[linear-gradient(150deg,rgba(255,255,255,0.92),rgba(247,241,233,0.88))] rotate-[-18deg] pp-float-delayed pp-shadow-soft',
  'right-[8%] top-[22%] h-28 w-28 rounded-full border-[12px] border-white/70 pp-sway',
  'left-[6%] top-[32%] h-24 w-24 rounded-[1.8rem] bg-[linear-gradient(150deg,rgba(255,244,160,0.94),rgba(255,224,87,0.84))] rotate-[-8deg] pp-float',
  'right-[2%] top-[40%] h-16 w-16 rounded-[1.3rem] bg-[linear-gradient(145deg,rgba(255,191,125,0.94),rgba(255,143,49,0.9))] rotate-[18deg] pp-float-delayed pp-shadow-soft',
  'left-[2%] top-[50%] h-24 w-40 rounded-[2rem] bg-[linear-gradient(155deg,rgba(255,255,255,0.92),rgba(237,233,255,0.9))] rotate-[8deg] pp-sway pp-shadow-soft',
  'right-[10%] top-[60%] h-36 w-36 rounded-full border border-[rgba(57,190,113,0.26)] pp-spin-slow',
  'left-[7%] top-[70%] h-20 w-20 rounded-[1.6rem] bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(228,242,255,0.92))] rotate-[16deg] pp-float pp-shadow-soft',
  'right-[-1rem] top-[78%] h-12 w-44 rounded-full bg-[linear-gradient(90deg,rgba(243,143,209,0),rgba(243,143,209,0.85))] rotate-[-28deg] pp-sway',
  'left-[4%] top-[86%] h-20 w-20 rounded-full border border-[rgba(255,159,64,0.28)] pp-orbit',
  'right-[4%] top-[91%] h-24 w-24 rounded-[1.4rem] bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(255,242,220,0.9))] rotate-[14deg] pp-float pp-shadow-soft',
  'left-[8%] top-[95%] h-12 w-48 rounded-full bg-[linear-gradient(90deg,rgba(51,152,255,0),rgba(51,152,255,0.8))] rotate-[24deg] pp-meteor-idle',
] as const

const meteors = [
  'left-[12%] top-[18%] w-28',
  'right-[8%] top-[30%] w-36',
  'left-[14%] top-[48%] w-32',
  'right-[16%] top-[62%] w-24',
  'left-[10%] top-[80%] w-36',
  'right-[12%] top-[93%] w-28',
] as const

const stickers = [
  {
    text: 'wow',
    className:
      'left-[6%] top-[10%] border-[rgba(255,159,64,0.2)] bg-white/80 text-[rgba(31,28,26,0.68)] pp-float',
  },
  {
    text: 'play',
    className:
      'right-[8%] top-[38%] border-[rgba(51,152,255,0.22)] bg-white/82 text-[rgba(31,28,26,0.66)] pp-sway',
  },
  {
    text: 'ship',
    className:
      'left-[10%] top-[74%] border-[rgba(243,143,209,0.22)] bg-white/84 text-[rgba(31,28,26,0.66)] pp-float-delayed',
  },
] as const

export default function PortfolioBackdropOrnaments() {
  return (
    <div className='pointer-events-none absolute inset-0 -z-10 overflow-hidden' aria-hidden>
      <div className='pp-grid-wash absolute inset-0 opacity-80' />
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(255,159,64,0.12),transparent_16%),radial-gradient(circle_at_86%_28%,rgba(51,152,255,0.1),transparent_18%),radial-gradient(circle_at_76%_72%,rgba(243,143,209,0.12),transparent_16%),radial-gradient(circle_at_18%_78%,rgba(57,190,113,0.1),transparent_14%)] opacity-90' />

      {/*
        Everything below is decoration. Grouped under `pp-decorations` so a page can opt
        out of the floating shapes, meteors and stickers while keeping the grid wash and
        colour gradients above - see `.portfolio-public-root:has([data-plain])` in
        globals.css. The IQ test page uses it: shapes drifting past the edge of a timed
        visual-reasoning test compete with the exact thing the taker is trying to look at.
      */}
      <div className='pp-decorations'>
      {ornaments.map((className, index) => (
        <div key={`${index}-${className.slice(0, 18)}`} className={cx('absolute hidden lg:block', className)}>
          {index === 1 ? (
            <div className='absolute inset-5 rounded-[1.2rem] border border-[rgba(31,28,26,0.06)] bg-[linear-gradient(180deg,rgba(17,17,17,0.88)_0_28%,rgba(255,255,255,0.84)_28%_100%)]' />
          ) : null}
          {index === 2 ? (
            <>
              <span className='absolute -left-3 top-5 h-6 w-6 rounded-full bg-[var(--pp-bg)]' />
              <span className='absolute -right-3 top-5 h-6 w-6 rounded-full bg-[var(--pp-bg)]' />
            </>
          ) : null}
          {index === 3 ? (
            <div className='absolute inset-[1.15rem] rounded-full border border-dashed border-[rgba(31,28,26,0.1)]' />
          ) : null}
          {index === 6 ? (
            <>
              <span className='absolute left-4 right-8 top-8 h-2 rounded-full bg-[rgba(123,109,255,0.2)]' />
              <span className='absolute left-4 right-12 top-12 h-2 rounded-full bg-[rgba(123,109,255,0.14)]' />
            </>
          ) : null}
          {index === 7 ? (
            <>
              <span className='absolute inset-5 rounded-full border border-dashed border-[rgba(57,190,113,0.22)]' />
              <span className='absolute right-5 top-5 h-5 w-5 rounded-full bg-[linear-gradient(145deg,#76dea0,#39be71)] shadow-[0_12px_22px_rgba(57,190,113,0.16)]' />
            </>
          ) : null}
          {index === 8 ? (
            <>
              <span className='absolute left-4 right-4 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[rgba(51,152,255,0.26)]' />
              <span className='absolute bottom-4 left-1/2 top-4 w-[3px] -translate-x-1/2 rounded-full bg-[rgba(51,152,255,0.26)]' />
            </>
          ) : null}
          {index === 9 ? (
            <span className='absolute right-0 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-[rgba(243,143,209,0.95)] shadow-[0_14px_24px_rgba(243,143,209,0.24)]' />
          ) : null}
          {index === 10 ? (
            <span className='absolute inset-4 rounded-full border border-dashed border-[rgba(255,159,64,0.3)]' />
          ) : null}
          {index === 11 ? (
            <>
              <span className='absolute left-4 top-4 h-4 w-4 rounded-full bg-[rgba(255,159,64,0.52)]' />
              <span className='absolute bottom-4 right-4 h-6 w-6 rounded-full bg-[rgba(51,152,255,0.24)]' />
            </>
          ) : null}
        </div>
      ))}

      {meteors.map((className, index) => (
        <span
          key={`${className}-${index}`}
          className={cx(
            'absolute hidden h-[3px] -rotate-[24deg] overflow-hidden rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.98))] lg:block',
            className,
            index % 2 === 0 ? 'pp-meteor' : 'pp-meteor-delayed',
          )}
        >
          <span className='absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[linear-gradient(145deg,#fff7d7,#ffb85b)] shadow-[0_0_22px_rgba(255,184,91,0.48)]' />
        </span>
      ))}

      {stickers.map(({ text, className }) => (
        <span
          key={text}
          className={cx(
            'absolute hidden rounded-full border px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.2em] shadow-[0_12px_24px_rgba(46,35,28,0.08)] backdrop-blur-md lg:block',
            className,
          )}
        >
          {text}
        </span>
      ))}

      <div className='absolute left-[5%] top-[8%] hidden h-20 w-32 rounded-[2rem] border-t-[3px] border-dotted border-[rgba(51,152,255,0.28)] rotate-[-12deg] lg:block' />
      <div className='absolute right-[17%] top-[28%] hidden h-24 w-24 rounded-full border-2 border-[rgba(51,152,255,0.18)] lg:block'>
        <span className='absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[rgba(51,152,255,0.18)]' />
        <span className='absolute inset-y-3 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[rgba(51,152,255,0.18)]' />
      </div>
      <div className='absolute left-[3%] top-[82%] hidden h-28 w-40 lg:block pp-float-delayed'>
        <div className='absolute inset-x-10 inset-y-5 rounded-full bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(236,233,255,0.96))] shadow-[0_12px_22px_rgba(123,109,255,0.08)]' />
        <div className='absolute left-3 top-8 h-16 w-16 rounded-full bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(236,233,255,0.96))] shadow-[0_12px_22px_rgba(123,109,255,0.08)]' />
        <div className='absolute right-4 top-4 h-[4.75rem] w-[4.75rem] rounded-full bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(225,248,235,0.96))] shadow-[0_12px_22px_rgba(57,190,113,0.08)]' />
      </div>
      </div>
    </div>
  )
}
