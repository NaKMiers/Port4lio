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

The second half of the rule, from `what-good-looks-like.md`: the title is a **label for a
discussion, not ad copy**. On Hacker News a promotional title gets rewritten by a moderator or
flagged, and around a fifth of front-page stories are penalised for something in that family.
Specific and true is what satisfies both halves. No "the ultimate guide", no colon-and-subtitle.

---

## The four things that decide whether a post is read

From `docs/blog/what-good-looks-like.md`, which is the research this section compresses. The
seven-step template above is a skeleton; these are what make it worth reading. All four are in
the generator's brief (`src/lib/blog/brief.ts`), and the first three are **measured** on the way
back out (`src/lib/blog/prose-audit.ts`) rather than merely asked for.

1. **Throughline.** The one claim the whole post hangs from, decided before the first sentence
   and stated in the opening. Not the topic - the claim. "The documented way to revalidate a
   dynamic route does nothing", not "a post about caching". The source calls deciding this 80%
   of the work, and a post without one is a survey.
2. **Hook.** The first two or three sentences produce something concrete: a scene, a number, a
   claim, the question the reader already has. Never a definition, never setup. On a long post,
   say early where it is going - a reader who can see the shape of the journey will take it.
3. **Evidence.** At least one thing in the post that no other page could tell the reader. This
   is the whole reason it exists, and it is also the only defence against AI Overviews: a page
   a model can synthesise without you is a page it will not cite. **Never invent a number.**
4. **The close.** Stop on the point. What you would do differently, or what is unresolved.

## What the generator refuses to produce

The brief bans three silhouettes by name, because the thing that makes a post read as generated
is not its vocabulary - it is its outline:

- **N parallel sections with parallel headings.** "Lỗi thứ nhất / Lỗi thứ hai / Lỗi thứ ba",
  "Mistake one / two / three". The most recognisable shape of machine-written prose, and it
  survives every other improvement. Sections are meant to be of unequal weight.
- **A closing section that restates the post.** Any heading under which nothing new happens.
- **The same sentence pattern opening three or more sections.**

All three are checked after generation and reported as warnings in the editor, along with em
dashes, banned phrases, and any date, duration, percentage or measurement in the body that is
not in the evidence you supplied. **Specifics inside code samples are checked too** - a
`TIMEOUT = 30` with a comment sourcing it to a vendor SLA is a fabricated measurement wearing a
citation.

## The formats beyond the seven-step template

The seven-step template is for `measured-in-production`. Nine shapes exist in
`STRUCTURE_TEMPLATES`, and **auto never leaves the choice to the model** - it derives one from
the style, then the series, then falls back to the zipline. The three added from the research:

| Structure       | Use it for                                   | The step that carries it                            |
| --------------- | -------------------------------------------- | --------------------------------------------------- |
| `zipline`       | one big topic, taken all the way down        | throughline first, then each section one rung down  |
| `in-medias-res` | a personal or career post that should travel | one arc, one revelation, then stop                  |
| `pillar-hub`    | the hub post of a cluster                    | it is the map, not the territory - link the cluster |

`isPillar` overrides all of it: a hub post always gets the hub shape.

A **pillar** is 2,500-4,000 words and covers the whole topic, linking down to 5-12 cluster posts
that link back up. The research number behind the shape: 86% of AI citations come from sites
with five or more interconnected pages on a topic, and two-way internal links raise citation
probability by about 2.7x. `relatedSlugs` is where the down-links live; the up-links have to be
added on the cluster posts by hand.

## Making every image, then publishing

The Generate dialog has one switch that is not a property of the post: **Make every image, then
publish**, under "After the model finishes". It is **off by default**, and off is the old
behaviour exactly - a post saved as `archived`, with its image prompts written and no pictures,
for you to make in the editor and publish by hand.

Turned on, the dialog keeps working after the post is saved. It draws the cover first, then each
`![image](imageN)` in body order, one call at a time against the Gemini image model chosen just
below the switch. Every URL is folded in and saved in a single PATCH - one save, not one per
image, because each save re-runs the whole body through Shiki.

**It publishes only a post that is finished.** The bar is four things, and each is visible damage
on a live page rather than a matter of taste: a title, a body, a cover image, and no placeholder
left over. Anything missing and the post stays archived with the reason on the result card. This
is the same refusal the board already makes - it raises a confirm before you publish a post with
placeholders in it, because a placeholder renders as a broken-image icon - so the automatic path
declines where the manual path asks. `publishBlockers` in `src/lib/blog/auto-illustrate.ts` is
the whole rule, and an excerpt is deliberately not on the list.

Two things worth knowing before pressing it:

- **The images are drawn from your browser**, not from the server. Closing the tab stops the run.
  Nothing is lost when it does - the post is already saved, with whatever pictures had arrived -
  but the rest have to be made in the editor.
- **It costs a model call per image**, priced on the dropdown. Up to five on a long post, so
  roughly $0.34 at Flash rates and $0.67 at Pro. `BLOG_GENERATE_IMAGE_LIMIT` allows thirty images
  per ten minutes, which is about six full posts.

## The daily cron

`POST /api/cron/blog` writes one post a day on its own. It is the same generator the dialog
uses - the whole of `runGeneration`, not a copy - with three things decided for it.

**The brief is sampled.** `src/lib/blog/cron-spec.ts` draws one of a dozen **angles**: a
coherent bundle of style, structure, hook, tone, length and code density that together describe
a post somebody would choose to write. Rolling each field independently would maximise variance
and produce confusion - `personal-essay` with `codeExamples: heavy` and `structure: reference`
is three instructions pulling three ways. Tone, audience, point of view and creativity jitter on
top, but only where the angle did not already have an opinion.

Notes are weighted four times heavier than any single article angle, because this doc commits to
8 notes per 2 articles and a daily job is the thing most able to honour that ratio and most
likely to drift off it. **No angle can produce a pillar.** A series holds exactly one, the
database enforces it, and spending that slot on a dice roll is unrecoverable.

Repetition is the real risk, and the model's only view of this blog is `relatedCandidates` -
which is _published_ posts. Every cron post is archived until you read it, so day two cannot see
day one. The route therefore reads the last 25 titles at **any** status and passes them as an
instruction: "these exist, write about something none of them covers".

**Images are on, and failure is survivable.** The post is saved as `archived` _before_ the first
image is drawn. Then the cover and every placeholder are drawn one at a time, each one saved as
it lands. An image that fails is skipped - its prompt stays on the post, the run keeps going, and
what arrives on the board is a post with one card left to press.

**It publishes only a whole post.** Same `publishBlockers` bar as the dialog's switch: a title, a
body, a cover, and no placeholder left over. Anything missing and it stays archived with the
reasons in the response. So an image provider having a bad morning costs a day's publish, never a
broken picture on a live page.

### Running it

`CRON_SECRET` must be set or the route 404s every caller - it never runs open. Send it as
`Authorization: Bearer <secret>`, which is what Vercel Cron does with that variable already.
Schedule it with **either** `vercel.json`'s `crons` entry **or**
`docs/blog/generate-daily.yml`, never both: two requests a day means one of them is refused
every morning and the 429 in the logs means nothing is wrong.

"1 blog/day" is enforced by the route, not by the schedule. `BLOG_CRON_LIMIT` is one per UTC
day, and it increments _before_ the work starts - which is what catches the failure a
"has a post been created today?" query cannot: this route can run for minutes, so a scheduler
whose own timeout is shorter records a failure and retries while the first post is still being
written.

## Language

**Vietnamese is the default for anything new.** `Post.language` defaults to `vi`, the generator
defaults to `vi`, and a Vietnamese post is written natively rather than translated - technical
nouns stay in English (`cache`, `deploy`, `build`), the register is `bạn`/`mình`, and the
`Đầu tiên... Thứ hai... Cuối cùng` paragraph habit is the Vietnamese equivalent of an em dash.
The full list is `VIETNAMESE_STYLE` in `src/lib/blog/generate.ts`.

Existing English posts are untouched and stay English. Choosing English on a post is one switch
in the dialog.

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
