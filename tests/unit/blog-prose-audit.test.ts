import { describe, expect, it } from 'vitest'

import { auditProse, type ProseFinding } from '@/lib/blog/prose-audit'

/**
 * The prose gate, tested against the generation that caused it to be written.
 *
 * The blog had a careful trust boundary around everything a post IS - kind, series, tags,
 * related slugs, all re-validated because the model said so is not a reason - and no check at
 * all on what the post SAYS, which is the entire product. A real Vietnamese generation came
 * back having broken four rules it had been given in the same request, and nothing anywhere in
 * the pipeline noticed:
 *
 * ```
 *   Lỗi thứ nhất / Lỗi thứ hai / Lỗi thứ ba   three parallel sections, the banned silhouette
 *   Ba lỗi, một gốc rễ                        a closing section that restates the post
 *   Đo ngày 2023-11-14, p99 ... 18s           measurements invented, hidden in a code comment
 *   Thứ cần đo: ... (x3)                      the old escape-hatch instruction become a formula
 * ```
 *
 * `REAL_GENERATION` below is that post, condensed to the failing parts. It is the fixture the
 * whole file is built around, because a gate that does not catch the specific thing that got
 * through is a gate nobody should trust.
 */

function codesOf(findings: ProseFinding[]): string[] {
  return findings.map(finding => finding.code)
}

function audit(
  bodyMarkdown: string,
  overrides: Partial<Parameters<typeof auditProse>[0]> = {}
) {
  return auditProse({
    bodyMarkdown,
    language: 'vi',
    evidence: '',
    structure: 'zipline',
    ...overrides,
  })
}

/** The audited generation, condensed. Every failure below was in the real output. */
const REAL_GENERATION = `## Senior engineer không viết code tệ vì thiếu kỹ năng

Họ viết code tệ vì biết quá nhiều thứ cùng một lúc.

## Lỗi thứ nhất: viết code cho phiên bản tương lai

Ticket gốc chỉ cần gửi email khi user đặt hàng thành công.

Thứ cần đo: đếm số abstraction layer trong một feature, chia cho số yêu cầu thực tế.

## Lỗi thứ hai: dùng context trong đầu thay vì viết vào code

\`\`\`python
# MAX_RETRY = 3: vendor API trả 429 sau lần thứ 3 liên tiếp. Đo ngày 2023-11-14.
MAX_RETRY = 3

# TIMEOUT = 30: p99 latency của vendor là 18s theo SLA của họ.
TIMEOUT = 30
\`\`\`

Thứ cần đo: đếm số magic number không có comment giải thích nguồn gốc.

## Lỗi thứ ba: tối ưu cho lần đọc thứ hai

Não bộ họ đã được huấn luyện để đọc code của chính họ.

Thứ cần đo: time-to-first-meaningful-contribution của engineer mới vào team.

## Ba lỗi, một gốc rễ

Cả ba lỗi đều có chung một nguồn: kinh nghiệm tạo ra blind spot.`

describe('the generation this gate was written for', () => {
  it('catches all four failures that got through unnoticed', () => {
    const codes = codesOf(audit(REAL_GENERATION))

    expect(codes).toContain('parallel-sections')
    expect(codes).toContain('recap-section')
    expect(codes).toContain('unsourced-specific')
    expect(codes).toContain('repeated-opening')
  })

  it('names the invented measurements, including the ones inside code', () => {
    // The code-sample clause exists because this is exactly where the fabrication went once
    // prose claims were banned. A date in a comment is still a date the author never measured.
    const [finding] = audit(REAL_GENERATION).filter(
      entry => entry.code === 'unsourced-specific'
    )

    expect(finding.message).toContain('2023-11-14')
    expect(finding.message).toContain('18s')
    expect(finding.message).toContain('Every one of these was invented')
  })

  it('quotes the repeated formula back rather than describing it', () => {
    const [finding] = audit(REAL_GENERATION).filter(
      entry => entry.code === 'repeated-opening'
    )

    expect(finding.message).toContain('thứ cần đo')
  })
})

describe('the banned silhouette', () => {
  const PARALLEL = `## Mistake one: over-abstraction

Body.

## Mistake two: no context

Body.

## Mistake three: dense code

Body.`

  it('fires on parallel headings that share a first word', () => {
    expect(codesOf(audit(PARALLEL, { language: 'en' }))).toContain(
      'parallel-sections'
    )
  })

  it('fires on ordinal headings in either language', () => {
    const vietnamese = `## Thứ nhất

a

## Thứ hai

b

## Thứ ba

c`

    expect(codesOf(audit(vietnamese))).toContain('parallel-sections')
  })

  it('leaves a genuinely unequal post alone', () => {
    // The check must not fire on correct output. A gate that cries wolf on good posts is a
    // gate the author stops reading, which costs the findings that are right.
    const good = `## Cái gì đã hỏng

a

## Tại sao

b

## Cái mình đã bỏ qua

c`

    expect(codesOf(audit(good))).not.toContain('parallel-sections')
  })

  it('does not fire on structures whose sections are meant to repeat', () => {
    // A reference is a list of entries somebody arrives at from a search; a digest is items in
    // a fixed repeating shape. Both are parallel on purpose.
    for (const structure of [
      'reference',
      'digest',
      'numbered-list',
      'tutorial',
    ])
      expect(
        codesOf(audit(PARALLEL, { language: 'en', structure })),
        structure
      ).not.toContain('parallel-sections')
  })

  it('needs three sections before it says anything', () => {
    const two = `## Mistake one

a

## Mistake two

b`

    expect(codesOf(audit(two, { language: 'en' }))).not.toContain(
      'parallel-sections'
    )
  })
})

describe('the closing recap', () => {
  it.each([
    ['vi', '## Mở đầu\n\na\n\n## Tóm lại\n\nb'],
    ['vi', '## Mở đầu\n\na\n\n## Ba lỗi, một gốc rễ\n\nb'],
    ['en', '## Opening\n\na\n\n## In summary\n\nb'],
    ['en', '## Opening\n\na\n\n## Final thoughts\n\nb'],
  ])('fires on a %s recap heading', (language, body) => {
    expect(
      codesOf(audit(body, { language: language as 'vi' | 'en' }))
    ).toContain('recap-section')
  })

  it('only looks at the LAST section', () => {
    // A post may legitimately summarise something in the middle - a summary of somebody else's
    // argument before answering it. What the brief forbids is ending on one.
    const body = `## Tóm lại quan điểm của họ

a

## Cái mình sẽ làm khác

b`

    expect(codesOf(audit(body))).not.toContain('recap-section')
  })
})

describe('specifics, and where they came from', () => {
  it('accepts a number the author supplied', () => {
    const body = '## Kết quả\n\nSau khi sửa, p99 giảm còn 18s.'

    expect(
      codesOf(audit(body, { evidence: 'p99 sau khi sửa: 18s' }))
    ).not.toContain('unsourced-specific')
  })

  it('tolerates formatting differences between the body and the evidence', () => {
    // "18s" in the post against "18 s" in a pasted note is the same measurement. A check that
    // failed on whitespace would fire on every correctly sourced post.
    const body = '## Kết quả\n\nĐộ trễ là 18s.'

    expect(codesOf(audit(body, { evidence: 'do tre: 18 s' }))).not.toContain(
      'unsourced-specific'
    )
  })

  it('flags a number that appears nowhere in the evidence', () => {
    const body = '## Kết quả\n\nĐộ trễ giảm 43%.'

    const [finding] = audit(body, { evidence: 'p99 là 18s' }).filter(
      entry => entry.code === 'unsourced-specific'
    )

    expect(finding.message).toContain('43%')
    expect(finding.message).toContain('not in the evidence you supplied')
  })

  it('leaves bare integers alone', () => {
    /*
      `BATCH_SIZE = 47` on its own is a plausible constant in illustrative code, and flagging it
      would fire on every code sample in every post. The patterns are restricted to specifics
      that are claims about the world - dates, percentiles, percentages, durations - which is
      what a reader would repeat and what the audited generation actually invented.
    */
    const body = '## Code\n\n```ts\nconst BATCH_SIZE = 47\n```'

    expect(codesOf(audit(body))).not.toContain('unsourced-specific')
  })

  it('says nothing about a post that asserts no specifics at all', () => {
    // The honest outcome when no material was supplied: an argument with no numbers in it.
    const body =
      '## Một quan điểm\n\nMình nghĩ abstraction sớm là vấn đề của kinh nghiệm, không phải của kỹ năng.'

    expect(codesOf(audit(body))).toEqual([])
  })

  it('notices when material was supplied and the post ignored it', () => {
    // The opposite failure, and the one nobody looks for: the evidence is the reason the post is
    // worth publishing, and a draft that did not use it has thrown that away.
    const body = '## Một quan điểm\n\nKhông có con số nào ở đây cả.'

    expect(
      codesOf(audit(body, { evidence: 'p99 giảm từ 400ms còn 18s' }))
    ).toContain('no-specifics')
  })
})

describe('the checks that are never wrong', () => {
  it('counts em and en dashes', () => {
    const [finding] = audit('## A\n\nmột — hai – ba')

    expect(finding.code).toBe('em-dash')
    expect(finding.message).toContain('2 em or en dashes')
  })

  it('names each banned phrase it found', () => {
    const [finding] = audit('## A\n\nTóm lại, hy vọng bài viết này hữu ích.')

    expect(finding.code).toBe('banned-phrase')
    expect(finding.message).toContain('tóm lại')
    expect(finding.message).toContain('hy vọng bài viết này hữu ích')
  })

  it('checks the tells of the language the post is in, not the other one', () => {
    // The two lists do not correspond, so running the English one over a Vietnamese post finds
    // nothing and reports nothing, which reads exactly like a clean post.
    const english = '## A\n\nLet us delve into it.'

    expect(codesOf(audit(english, { language: 'en' }))).toContain(
      'banned-phrase'
    )
    expect(codesOf(audit(english, { language: 'vi' }))).not.toContain(
      'banned-phrase'
    )
  })

  it('passes a clean post with nothing to say', () => {
    const clean = `## Chuyện đã xảy ra

Build fail, không có log nào.

## Cái mình đã thử trước

Rollback, và nó không giúp gì.`

    expect(audit(clean)).toEqual([])
  })

  it('survives an empty body without inventing findings', () => {
    expect(audit('')).toEqual([])
  })
})

describe('the Unicode trap that disabled two checks', () => {
  /*
    JavaScript's `\b` is defined against `\w`, which is ASCII. "Lỗi thứ" ends in "ứ" and
    "một gốc rễ" ends in "ễ", so a trailing `\b` on either pattern can never match the heading it
    was written for.

    Both of these shipped in the first draft of this file and both were dead: they matched
    nothing, reported nothing, and a post carrying the exact failure came back clean. Worth two
    tests of their own because a disabled check is indistinguishable from a passing post, which
    is the single most expensive failure mode a gate has.
  */

  it('detects ordinal headings even when the first words differ', () => {
    // The shared-first-word path cannot fire here - lỗi, sai, thứ are three different words - so
    // only the ordinal pattern can catch this, which is what makes it a real test of it.
    const body = `## Lỗi thứ nhất

a

## Sai lầm thứ hai

b

## Thứ ba là gì

c`

    expect(codesOf(audit(body))).toContain('parallel-sections')
  })

  it('detects a recap heading ending in a non-ASCII letter', () => {
    const body = '## Mở đầu\n\na\n\n## Ba lỗi, một gốc rễ\n\nb'

    expect(codesOf(audit(body))).toContain('recap-section')
  })
})
