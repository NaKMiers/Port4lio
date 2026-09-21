# What a good blog looks like: research notes

Desk research, September 2026. The question was "what do successful blogs in my topics
actually do", across IT/dev, AI, tech-inspiration, make-money-online, meaningful-life, and
funny/inspiring stories. Sources are listed at the bottom; this file is the extraction, not
the reading list.

Read this as input to a plan, not as a plan. The last section maps it onto what
`src/app/(blog)` already has.

---

## 0. The 2026 context, because it changes the answer

Three findings that override most pre-2024 blogging advice:

1. **Generic explainers are dead as a traffic strategy.** HubSpot's blog went from ~13.5M
   monthly visits to under 2M in about ten months, roughly an 81% drop, because AI Overviews
   now answer the "what is a CRM" questions that blog was built on.
2. **Ranking and being cited have come apart.** Overlap between top Google links and the
   sources AI engines actually quote fell from ~70% to under 20%. The goal moved from "rank
   #1" to "be the page the model has no choice but to cite".
3. **What survives is what a model cannot synthesise without you.** First-hand experience,
   original data, a named author with a real track record. Original research and case studies
   are the most-cited content type by AI engines. A "7 tips" listicle is exactly what a model
   generates for free.

This is good news for a personal blog and bad news for a content farm. The whole formula
below is a consequence of it.

---

## 1. The formula, in seven parts

### 1.1 One narrow promise, repeated until it is a reputation

Every blog in the sample is reducible to one sentence a reader can hold:

| Blog                  | The one sentence                                                   |
| --------------------- | ------------------------------------------------------------------ |
| Julia Evans (jvns.ca) | "Things I was confused by, explained the way I wish they had been" |
| Coding Horror         | "Opinionated takes on the craft of software"                       |
| Martin Fowler         | "Patterns and architecture, named properly"                        |
| Wait But Why          | "One huge topic, taken all the way down, with stick figures"       |
| Farnam Street         | "Mental models for thinking and deciding better"                   |
| Ben's Bites           | "What happened in AI yesterday, told like a friend"                |
| The Oatmeal           | "Long-form humour essays that look like infographics"              |

None of them is "a blog about tech". The promise is narrow enough that a reader can predict
what the next post will be and still want to read it.

James Clear's own account of this: his first blog, on business marketing, did not work. It
worked when he switched to habits, a topic he actually cared about and that "everyone in the
world can benefit from reading about".

### 1.2 Volume before leverage, and the numbers are brutal

- James Clear: ~200 articles before the book deal, ~100 more before publication.
- Mark Manson: 500+ posts and 8 years before writing paid the bills.
- Tim Urban: a post every Tuesday for the first 18 months, specifically to earn the trust that
  later let him take months between posts.

The pattern is the same in all three: a fixed, visible cadence first, which buys the right to
go slower and bigger later. Cadence is the promise; quality is what you do inside it.

### 1.3 The unit of value is first-hand experience, not coverage

Julia Evans' "blogging myths" post is the cleanest statement of the operating rules, and every
one of them cuts against how people default to writing:

- You do not need to be original. "If I found it confusing, lots of other people probably did
  too."
- You do not need to be an expert. You need 1-2 things the reader does not have. Freshly
  learned knowledge is _more_ valuable, not less, because you remember the confusion.
- Posts do not need to be 100% correct. Say "I think" and "my understanding is" and publish.
- Do not explain every concept. Write for one specific person. "Writing that's easy to
  understand for 1 person has a good chance of being easy to understand for many others."
- More material is not better. A short post that teaches two things beats a comprehensive
  deep-dive that stays in drafts.
- Page views are the wrong metric. One comment saying "this helped me" is the signal.

This lines up exactly with the E-E-A-T/AI-citation finding in section 0. The thing that makes
a post humanly useful in 2026 is the same thing that makes it machine-uncopyable: you were
there, it broke, here is what happened.

### 1.4 Structure: the throughline, then the hook, then the scaffolding

Tim Urban's process is the most explicit on record:

- **Map the reader.** Pick where they start on a 1-10 knowledge scale and where you are
  delivering them. His target is 6: "can answer any layman's question and form intelligent
  opinions", deliberately not expert.
- **Stretch the zipline.** Find the one sentence the whole post hangs from before writing. For
  a 150-hour cryonics post it was "the definition of death is not what you think it is".
  "Wrapping your own brain around it and then conceiving how to present it, that's 80% of the
  work."
- **Hook by revealing the arc.** For long posts, tell the reader early where this is going.
  Length loses people; knowing the shape of the journey keeps them.
- **Visuals must carry information, never decorate.** Crude hand-drawn diagrams beat polished
  stock imagery. The "instant gratification monkey" is a concept made memorable by being given
  a body.
- **Pick a narrator.** Sometimes a character, sometimes direct address, but chosen on purpose.

For the short/personal end of the range, the viral-essay pattern is: open in the middle of the
action (dialogue, a shock, a vivid image), carry one emotional arc, land a one-line revelation
at the end. Emotion inside the first ~10 seconds or the reader is gone.

### 1.5 The sharing engine is identity, not information

The reason inspiring and funny posts travel: people share what says something about who they
are or want to be. "I share this because it describes me." Information alone does not move;
information that hands the reader an identity does.

Practical consequence: every post that is meant to spread needs at least one line that a
reader would quote _about themselves_. That is the tweet, the screenshot, the share.

Format matters here too. The Oatmeal works as "storytelling-meets-infographics" on a page with
no ads and nothing interrupting the flow. xkcd proves the opposite extreme: minimal art, the
idea is the product. Either works. A cluttered page does not.

### 1.6 Distribution: search brings strangers, email keeps them

The consensus shape in 2026 is a split of jobs:

- **Discovery** happens on search, AI answers, social, communities, and other people's
  newsletters.
- **Trust, repetition and selling** happen in email, because it is the only channel you own
  and the only one an algorithm change cannot take away.

Benchmarks to calibrate against, not to chase:

- Marketing/newsletter email averages ~20.7% open rate, ~2.3% CTR.
- Established creator newsletters: 3-7% click rate.
- Free-to-paid conversion for established newsletters: 1-3%. Median across beehiiv is 0.62%,
  but the top decile in a good vertical hits 18%+. The spread is the whole story: niche and
  trust beat volume by more than an order of magnitude.

Hacker News, for the dev/AI side: titles are treated as shared labels for a discussion, not ad
copy. Linkbait or promotional titles get rewritten or flagged. About 20% of front-page stories
get penalised in some way. The winning move is a plain, accurate, specific title on something
genuinely new.

### 1.7 Architecture: pillars and clusters, now for models as well as crawlers

The pillar/cluster model held up better in 2026 research than most SEO tactics, for a new
reason: LLM crawlers use link topology as a topical-authority signal.

- 86% of AI citations come from sites with five or more interconnected pages on the topic.
- The average cited cluster is one pillar plus about eight articles.
- Bidirectional internal linking increases AI citation probability by ~2.7x.
- Pillar page: 2,500-5,000 words, acting as a table of contents for the topic.

So the shape is: pick 2-4 topics you intend to own, write one pillar each, then 5-12 posts that
link up to it and that it links back down to. Coverage completeness matters more than a
specific count.

---

## 2. Per-topic playbooks

### IT / software development

Winners: Julia Evans, Coding Horror, Martin Fowler. The formula is _confusion, resolved,
first-hand_. Evans wins on "here is a thing I struggled with", Fowler on naming patterns
precisely, Atwood on opinion delivered clearly. Nobody wins on tutorials that duplicate the
docs. Comics and diagrams are a differentiator, not a nice-to-have.

### AI

Winners are newsletters more than blogs: TLDR AI (~1.1M daily subscribers), Ben's Bites, Import
AI. The formula is _dense curation in a fixed daily/weekly shape, in a human voice_. Ben's
Bites explicitly writes "like a friend telling you what happened yesterday, not like a
corporate editor". Import AI wins by occupying a specific intersection (research meets policy)
rather than covering everything. Searches for "AI newsletter" grew 900% YoY, so the format is
not saturated yet, but the undifferentiated daily-roundup slot is.

For a blog rather than a newsletter, the transferable part is: pick the intersection nobody
else sits on, and be consistent about shape.

### Tech / inspiring stories

Wait But Why: 1.5M+ unique visitors a month, 300k+ email subscribers, on long-form. It
disproved "thoughtful and viral are mutually exclusive". The mechanism is the zipline plus the
stick figures plus the weekly cadence in year one.

### Make money online

Pat Flynn (Smart Passive Income), Michelle Schroeder-Gardner (Making Sense of Cents), the Indie
Hackers milestone culture. The formula is _specific numbers, published on a schedule, about
yourself_. Income reports work because they are original data nobody else can produce, which is
exactly the thing section 0 says still gets cited. The genre's failure mode is advice about
making money written by someone who has not made any.

Build-in-public is the same mechanism at a smaller scale: narrow problem, ship an MVP fast,
report the real numbers, engage where the audience already is.

### Meaningful things in life

Farnam Street, The Marginalian, James Clear, Mark Manson. Two things carry it: evergreen topics
chosen because "everyone in the world can benefit" (Clear's posts from 2012 still pull
traffic), and vulnerability used as a trust device. Manson's growth came from personal
storytelling and brutal honesty, so readers stopped seeing an information-dispenser and started
seeing someone who had been through it.

### Funny / inspiring stories

The Oatmeal and xkcd. Long-form humour essays with drawings, or one panel and one idea. Clean
page, no interruptions. Cultural specificity (internet culture, cats, modern anxieties) is what
makes them shareable, and the share is identity-driven per 1.5.

---

## 3. A post template that falls out of all of this

1. **Title**: plain, specific, true. Contains the concrete noun and the surprise. No "10 ways".
2. **Hook, first 2-3 sentences**: the moment it broke, or the sentence that reframes the topic.
   Reveal the arc if the post is long.
3. **The throughline**: one sentence, stated early, that the whole post hangs from.
4. **The evidence you own**: the numbers, the screenshot, the diff, the thing you measured.
   This is the citation bait and the reason the post exists.
5. **The body**: short sections, each teaching one thing, written for one named reader.
   Diagrams that carry information.
6. **The quotable line**: one sentence a reader would share about themselves.
7. **The close**: what you would do differently, or what is still unresolved. Honest beats
   conclusive.
8. **One next step**: the related post, the series, or the email signup. Exactly one.

---

## 4. How this maps onto Port4lio's blog as it stands

What is already right and should not be touched:

- **The series are positioned correctly.** `measured-in-production`
  ("things I tested against a real build, where the result contradicted the docs"),
  `shipping-side-products` (real traffic numbers), `dev-career-vn` (one lens, not general
  advice). All three are first-hand-experience formats. That is precisely the category section
  0 says still gets cited. Do not dilute these into general tech commentary.
- **`isPillar` exists on the model**, so the cluster architecture is already expressible.
- **RSS, sitemap, JSON-LD, `contentUpdatedAt`, subscribe form, `PostEvent` tracking** are all
  in place, which is more than most blogs at this stage.

Where the research suggests the gap is:

1. **Pillar coverage.** The evidence wants one pillar of 2,500-5,000 words per series, with
   8-ish posts linking bidirectionally. Worth auditing how many `isPillar` posts exist and
   whether `relatedSlugs` is genuinely bidirectional, since the 2.7x citation lift is
   specifically on two-way links.
2. **Cadence as a public promise.** Urban and Clear both bought their audience with a visible
   fixed schedule before earning the right to slow down. Nothing on the index currently makes
   a cadence promise.
3. **Original numbers per post.** The `measured-in-production` series is built for this. The
   question to ask of every draft: what number in here could nobody else have produced?
4. **The quotable line and the hook.** Both are craft-level and both are things the generator
   in `src/lib/blog/generate.ts` could be prompted for explicitly, rather than being left to
   chance.
5. **Diagrams.** Every visual-heavy blog in the sample (Evans, Urban, Inman) outperformed its
   text-only peers. The `imagePrompts` mechanism produces briefs for illustrations; the
   research says those should carry information, not decorate.
6. **The vi/en split.** Localisation, not translation: imagery, examples and humour have to be
   adapted, not just the words. Reciprocal hreflang on every pair, and ideally per-language
   sitemaps.

The one thing to resist: the site's kill criterion is contact messages carrying a
`sourceSlug`, and almost every growth tactic in this research optimises for reach instead.
Reach is upstream of that metric, not a substitute for it.

---

## Sources

- [Julia Evans, "Some blogging myths"](https://jvns.ca/blog/2023/06/05/some-blogging-myths/)
- [First Round Review, "Wait But Why's Tim Urban on Parsing and Transmitting Complex Ideas"](https://review.firstround.com/wait-but-whys-tim-urban-on-parsing-and-transmitting-complex-ideas/)
- [How James Clear went from blogger to world-renowned thought-leader](https://workshoppro.substack.com/p/how-james-clear-went-from-blogger)
- [Mark Manson: From Struggling Self-Help Blogger To 20m Books Sold](https://www.penpivot.com/p/mark-manson)
- [20VC: Scaling Wait But Why to 600,000 Subs](https://www.thetwentyminutevc.com/tim-urban)
- [Wait But Why (Wikipedia)](https://en.wikipedia.org/wiki/Wait_But_Why)
- [7 Best Programming Blogs Every Developer Should Follow in 2026](https://vinish.dev/top-programming-blogs)
- [Best Software Development Blogs 2026 (draft.dev)](https://draft.dev/learn/software-development-blogs)
- [Best AI Newsletters 2026 (Dupple)](https://dupple.com/learn/best-ai-newsletters-2026)
- [Best AI Newsletters in 2026: Ranked and Reviewed (DevBrief)](https://devbrief.ai/blog/best-ai-newsletters-2026-ranked-reviewed)
- [SEO in 2026: What Actually Moves Rankings Now](https://www.designntrendy.com/blog/seo-2026.html)
- [AI-Generated SEO Content in 2026: What It Actually Takes to Rank](https://www.fokal.com/ai-seo/ai-generated-seo-content/)
- [Topic Clusters & Internal Linking Strategy: A 2026 Guide](https://linksurge.jp/blog/en/topic-cluster-internal-linking-strategy/)
- [Internal Linking Strategy & Topical Authority Playbook](https://www.digitalapplied.com/blog/internal-linking-strategy-topical-authority-playbook-2026)
- [The State of Newsletters 2026 (beehiiv)](https://www.beehiiv.com/blog/the-state-of-newsletters-2026)
- [The State of Paid Newsletters 2026 (beehiiv)](https://www.beehiiv.com/blog/the-state-of-paid-newsletters-2026)
- [Email Marketing Benchmarks 2026 (Brevo)](https://www.brevo.com/blog/email-marketing-benchmarks/)
- [How Hacker News ranking really works](https://www.righto.com/2013/11/how-hacker-news-ranking-really-works.html)
- [Hacker News Posting Guide: Rules, Show HN, and Timing](https://syften.com/blog/hacker-news-marketing/)
- [I Analyzed 80+ Viral Substack Notes](https://thewritinglonggame.substack.com/p/i-analyzed-80-viral-substack-notes)
- [How to Create a Narrative Arc for Personal Essays (Writer's Digest)](https://www.writersdigest.com/improve-my-writing/how-to-create-a-narrative-arc-for-personal-essays)
- [The Oatmeal (Wikipedia)](https://en.wikipedia.org/wiki/The_Oatmeal)
- [From grains of 'Oatmeal,' big things for cartoonist (CNN)](https://edition.cnn.com/2013/01/31/tech/oatmeal-inman-web-comics/index.html)
- [Farnam Street: About](https://fs.blog/about/)
- [Indie Hacker Income Reports: Learning from Real Revenue Data](https://calmops.com/indie-hackers/indie-hacker-income-reports-guide/)
- [7 Multilingual SEO Strategies For Success (Surfer)](https://surferseo.com/blog/multilingual-seo/)
