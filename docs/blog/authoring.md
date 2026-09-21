# Writing for /blog

This exists because the plan can ship 100% of its tasks and produce zero posts. Everything
below removes a decision you would otherwise make from scratch every time.

The commitment is **2 articles + 8 notes in 6 weeks**, not "5 posts". An undifferentiated
target means five flagship attempts, which is exactly how this stalls.

---

## The two tiers

|          | `article`                    | `note`                                |
| -------- | ---------------------------- | ------------------------------------- |
| Length   | 800-2000 words               | 150-500 words                         |
| Needs    | cover image, excerpt, series | nothing but a title and a body        |
| Template | the full one below           | one observation, one code block, done |
| Target   | 2 in 6 weeks                 | 8 in 6 weeks                          |

The `note` tier is not a lesser article. It is the tier that keeps the blog alive between
articles, and a blog with only the expensive format is the one that goes quiet - of 27 blogs
reviewed for this feature, 10 had. If a note is taking more than 40 minutes, it has become an
article and should be cut back or promoted deliberately.

---

## The three clusters

Each has one **pillar** post - the hub the others link into. At most one pillar per series;
the database enforces it with a partial unique index, so a second one fails at save.

### 1. `measured-in-production`

Things you tested against a real build where the result contradicted the documentation. This
is the cluster with the strongest claim, because almost nobody publishes measurements.

**Pillar:** _"Five things Next.js 16 did that its docs didn't say."_

Already in this repo's comments, ready to be written:

- `revalidatePath('/blog/[blog-slug]', 'page')` - the documented pattern form - is a complete
  no-op. The literal path works. (`src/lib/blog/revalidate.ts`)
- `revalidateTag` did not invalidate what it claimed to. (`src/lib/ccaf/progress-data.ts`)
- Sitemap hreflang via `<xhtml:link>` kills Chrome's XML tree viewer: 800px of flat text vs
  4083px of tree, same feed. (`src/app/sitemap.ts`)
- A metadata image file only attaches to a page in the **same segment directory** - moving
  `page.tsx` into a route group and leaving `opengraph-image.tsx` behind drops `og:image`
  entirely, with no warning and no build error.
  (`src/app/(choice)/[lang]/mbti/(pitch)/layout.tsx`)
- Shiki costs a ~5.5s one-time bootstrap per process, paid by every build worker and every
  cold lambda. (`src/lib/blog/markdown.ts`)
- `sparse` vs `partial` unique indexes on a present-and-null field: the happy path passes and
  the second document ever created gets rejected. (`tests/api/retention.test.ts`)
- `generateStaticParams` that throws fails the **entire build**, not just its own route.
  (`src/app/(blog)/blog/[blog-slug]/page.tsx`)
- `script-src 'self'` silently kills hydration, because Next's own bootstrap is unnonced.
  (`next.config.js`)

### 2. `shipping-side-products`

MBTI, IQ, the share loop, the traffic, and the zero.

**Pillar:** _"Two viral tests, 0 job offers: what I actually learned."_

### 3. `dev-career-vn`

Personal story and advice, through exactly one lens: a Vietnamese developer getting work.

**Pillar:** _"How I actually get hired (and why the portfolio didn't help)."_

**Cut deliberately:** "interesting IT things" is the `note` tier, not a cluster. General life
advice is cut - scattered life advice converts nobody.

---

## The post template

Steal it every time. A repeatable template removes the blank-page cost, which is the real
reason posts do not get written.

```
1. Context          what I was building, in two sentences
2. What I measured  the thing I actually ran
3. What I expected  the documented or obvious answer
4. What happened    the number, the output, the error
5. Root cause       why
6. What I rejected  the fixes I did not take, and why
7. What I'd tell you the one-line takeaway
```

Section 6 is the one people skip and the one that signals seniority. Anyone can report a fix;
naming the alternatives you rejected is what shows judgement.

## The title rule

**Every `article` title contains a number or a named failure.** Not negotiable.

- ✅ "Five things Next.js 16 did that its docs didn't say"
- ✅ "revalidateTag didn't invalidate anything"
- ❌ "Some thoughts on Next.js caching"

---

## The LLM policy

Direct leverage on the real bottleneck, which is that your English prose is weaker than your
Vietnamese. Three roles, and only three:

1. **Translator** - write the draft in Vietnamese, have the model translate it.
2. **Editor** - have it tighten the English. Then read every sentence and put your own words
   back where it flattened them.
3. **Interrogator** - give it your draft and ask: _what number is missing? what alternative
   did I not name? where am I asserting instead of showing?_

**Never author.** The blog's entire job is to make a reader believe you think well, and in
2026 AI-generated prose is a negative credibility signal to exactly the senior-engineer
audience that matters. A post that reads as generated fails at its only task.

---

## Cross-posting

The canonical URL is always `anhkhoa.info/blog/<slug>`.

| Channel  | Language   | Notes                                              |
| -------- | ---------- | -------------------------------------------------- |
| DEV.to   | English    | `canonical_url` in the front matter, pointing here |
| Viblo    | Vietnamese | a **native post**, not a translation - see below   |
| LinkedIn | English    | excerpt + link, never the full text                |

**Viblo is the native home of the Vietnamese version (D7).** Write it as a Vietnamese post
for a Vietnamese audience, ending with the availability line in Vietnamese and a link to the
English original as "bản tiếng Anh đầy đủ". It is not a syndicated translation and `/blog`
does not carry a Vietnamese copy.

Every cross-post ends with the availability line. The one P0 conversion criterion must exist
on the channel where the audience actually is, not only on the domain.

---

## Running the tests

`npm test` is vitest only. The e2e suite is separate and **refuses to run against a database
that is not disposable** - it creates and soft-deletes posts, and a soft delete retains its
slug permanently by design, so every run would otherwise leave a document in production that
can never be cleaned up without undermining the behaviour being tested.

```bash
npm run test:e2e:local
```

Set `E2E_ALLOW_DB` to the database name you are willing to have written to.
