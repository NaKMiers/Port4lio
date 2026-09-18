import type { Localized } from '@/lib/ccaf/copy'

/**
 * The CCA-F study path: four weeks, 26 days, 68 tasks, in Vietnamese and English.
 *
 * The content is static by design - it is a plan, not user data - so it lives here beside
 * the other authored content modules (`lib/mbti/questions`, `lib/iq/items`) rather than in
 * Mongo. Only a viewer's progress against it is stored, in `models/CcafProgress`.
 *
 * ## Why the days are shaped the way they are (13/09)
 *
 * The first version budgeted Academy courses at video runtime. The reader studies with a
 * terminal open and a notebook beside it, which is roughly double, and by 13/09 that gap
 * had accumulated into a three-day slip - six days of plan done in nine days of calendar.
 * The workload did not change; it is still 68 tasks. What changed:
 *
 *   - The first eighteen tasks are laid out across the nine days they really took
 *     (04-12/09) rather than the six they were planned for, so the tracker stops
 *     reporting a slip that was really a mis-estimate and 13/09 lands on day 10.
 *   - Hours are re-budgeted at the measured pace, and the load is weighted onto Sat/Sun.
 *     The reader is at an office 08:30-18:30 on weekdays, so a weekday evening carries
 *     ~3 hours of short courses and config work, and the long builds go on the weekend.
 *     19-20/09 is the last weekend with room to build in; everything after it is mocks
 *     and consolidation on work nights, which is why Ex1-Ex4 are front-loaded onto it.
 *
 * ## A week is seven days
 *
 * `WEEKS` is a calendar, not a set of phases: every week holds seven consecutive dates
 * starting 04/09, and only the last is short because the plan ends on the 30th. An earlier
 * cut stretched week 1 to nine days so that the finished work sat inside one tab, which
 * made "week" mean two different things on one page - a seven-day grid in three places and
 * a nine-day one in the fourth. The finished work now simply spills into week 2, where
 * 11/09 and 12/09 belong; the tab reads 3/17 on a Sunday morning and that is the truth.
 *
 * ## Task ids are load-bearing
 *
 * Every task id is `<weekId>-<dayIndex>-<taskIndex>`, assigned by position. Progress rows
 * and the exported JSON snapshots from the old tracker both key on these strings, so
 * REORDERING OR REMOVING A TASK SILENTLY REASSIGNS SOMEONE ELSE'S TICKS. Append inside a
 * day, or add a day at the end of a week; do not insert in the middle.
 *
 * Both the 13/09 regrouping and the seven-day re-slice after it did exactly that,
 * deliberately, and each migrated the stored document in the same change. That was only
 * safe because the finished tasks were a contiguous prefix and kept their order, so the
 * old-to-new map was mechanical. A future reshuffle will not be that lucky - generate the
 * id map from the edit itself and migrate with it; do not hand-write either.
 *
 * ## Why both languages sit on the same line
 *
 * Every translatable field is a `Localized` pair rather than living in a parallel
 * per-language file keyed by id. Two files drift: somebody adds a task, the build still
 * passes, and one language quietly renders a gap. Here the type makes an untranslated
 * field a compile error, and a reviewer sees source and translation together.
 *
 * ## The step markup
 *
 * `steps` and `doneWhen` carry a deliberately tiny inline vocabulary - `<strong>`,
 * `<em>`, `<code>` and `{linkKey|label}` - rendered by `components/ccaf/RichText`.
 * It is parsed into React elements, never injected as HTML: bare tags would arrive
 * unstyled in a Tailwind project, and parsing keeps the door shut on markup arriving from
 * anywhere but this file.
 *
 * Code spans are identical across languages on purpose: `stop_reason` is `stop_reason`
 * in every language, and a translated identifier would be a bug someone pastes into a
 * terminal.
 */

/** Which exam domain (or chore) a task serves. Drives the chips on each row. */
export type TaskTag = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'm' | 'a'

export const TAG_LABEL: Record<TaskTag, Localized> = {
  d1: { vi: 'D1 Agentic', en: 'D1 Agentic' },
  d2: { vi: 'D2 Tool/MCP', en: 'D2 Tool/MCP' },
  d3: { vi: 'D3 Claude Code', en: 'D3 Claude Code' },
  d4: { vi: 'D4 Prompt/Output', en: 'D4 Prompt/Output' },
  d5: { vi: 'D5 Context', en: 'D5 Context' },
  m: { vi: 'Mock', en: 'Mock' },
  a: { vi: 'Admin', en: 'Admin' },
}

/** Link targets referenced from step text as `{key|label}`. */
export const LINKS: Record<string, string> = {
  aca: 'https://anthropic.skilljar.com',
  guide:
    'https://everpath-course-content.s3-accelerate.amazonaws.com/instructor/6nizmqk8tpzpfjvt6qmmav7rh/public/1783542750/Claude+Certified+Architect+%E2%80%93+Foundations+Exam+Guide.pdf',
  nc: 'https://nguyenchau.dev/learn/claude/claude-certified-architect-foundations',
  mock: 'https://nguyenchau.dev/learn/claude/claude-certified-architect-foundations#exam',
  n1: 'https://nguyenchau.dev/learn/claude/cca-f-domain-1',
  n2: 'https://nguyenchau.dev/learn/claude/cca-f-domain-2',
  n3: 'https://nguyenchau.dev/learn/claude/cca-f-domain-3',
  n4: 'https://nguyenchau.dev/learn/claude/cca-f-domain-4',
  n5: 'https://nguyenchau.dev/learn/claude/cca-f-domain-5',
  cc: 'https://code.claude.com/docs',
  api: 'https://platform.claude.com/docs',
  vue: 'https://www.pearsonvue.com/anthropic',
  partner: 'https://claude.com/partners',
}

/** The five scored domains and their exam weights, which sum to 100. */
export const DOMAINS = [
  {
    key: 1,
    name: 'Agentic Architecture & Orchestration',
    short: 'Agentic',
    weight: 27,
  },
  {
    key: 2,
    name: 'Tool Design & MCP Integration',
    short: 'Tool/MCP',
    weight: 18,
  },
  {
    key: 3,
    name: 'Claude Code Configuration & Workflows',
    short: 'Claude Code',
    weight: 20,
  },
  {
    key: 4,
    name: 'Prompt Engineering & Structured Output',
    short: 'Prompt/Output',
    weight: 20,
  },
  {
    key: 5,
    name: 'Context Management & Reliability',
    short: 'Context/Reliability',
    weight: 15,
  },
] as const

export type RoadmapTask = {
  /** `<weekId>-<dayIndex>-<taskIndex>`. Stable; see the note above. */
  id: string
  title: Localized
  tags: TaskTag[]
  steps: Localized[]
  doneWhen: Localized
  /** Optional shell/JS snippet shown under the steps. Never translated. */
  code?: string
}

export type RoadmapDay = {
  id: string
  /**
   * ISO date, or null for the exam day - that one floats to whatever the viewer set as
   * their exam date, so it cannot be fixed here.
   */
  date: string | null
  /** Set on the day that tracks the booked exam date rather than a fixed calendar slot. */
  floating?: 'exam'
  /** Planned hours, used for the per-week budget line. */
  hours: number
  title: Localized
  tasks: RoadmapTask[]
}

export type RoadmapWeek = {
  id: string
  label: Localized
  phase: Localized
  range: string
  /** Calendar span in days - the segment widths on the timeline are proportional to it. */
  span: number
  desc: Localized
  days: RoadmapDay[]
}

export const WEEKS: RoadmapWeek[] = [
  {
    id: 'w1',
    label: { vi: 'Tuần 1', en: 'Week 1' },
    phase: {
      vi: 'Nền tảng + khoá API',
      en: 'Foundations + API course',
    },
    range: '04-10/09',
    span: 7,
    desc: {
      vi: 'Bảy ngày đầu, ghi lại đúng như đã diễn ra chứ không như kế hoạch cũ: khoá "Building with the Claude API" 85 bài rải mỏng qua các tối đi làm, cuối tuần dồn nhiều hơn. 15 việc / 20,5 giờ - tốc độ thật ≈2,9 giờ mỗi ngày, và đó là con số dùng để dựng lại toàn bộ phần còn lại.',
      en: 'The first seven days, recorded the way they actually happened rather than the way they were planned: the 85-lesson "Building with the Claude API" course spread thin across work-night evenings, heavier at the weekend. 15 tasks / 20.5 hours - a real pace of ≈2.9 hours a day, and that is the number the rest of the plan is rebuilt from.',
    },
    days: [
      {
        id: 'w1-0',
        date: '2026-09-04',
        hours: 2,
        title: {
          vi: 'Khởi động & đọc luật chơi',
          en: 'Kickoff & read the rules',
        },
        tasks: [
          {
            id: 'w1-0-0',
            title: {
              vi: 'Xác nhận với L&D (chị Daisy / anh Hoàng Dương) đã có tên trong sheet "Danh sách thi" và email công ty được cấp quyền Partner Academy',
              en: 'Confirm with L&D (Daisy / Hoàng Dương) that your name is on the "Exam list" sheet and that your company email has Partner Academy access',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Mở lại tin nhắn nhắc của L&D, bấm link sheet <strong>Danh sách thi</strong>, kiểm tra đã có tên mình chưa - chưa có thì điền ngay, hạn chốt là <strong>thứ Sáu 04/09</strong>.',
                en: 'Reopen the reminder message from L&D, click the <strong>Exam list</strong> sheet link, and check whether your name is there - if not, add it right away; the deadline is <strong>Friday 04/09</strong>.',
              },
              {
                vi: 'Nhắn riêng hỏi đúng 3 ý: (1) email công ty nào dùng để đăng ký, (2) công ty đang ở tier nào trong {partner|Claude Partner Network} - tier quyết định mức giảm phí $125, (3) công ty tài trợ mấy lần thi.',
                en: 'Send a direct message asking exactly 3 things: (1) which company email to register with, (2) what tier the company is in within {partner|Claude Partner Network} - the tier determines the discount on the $125 fee, (3) how many exam attempts the company sponsors.',
              },
              {
                vi: 'Ý (3) quan trọng: nếu chỉ tài trợ 1 lần thì rớt là tự trả, ảnh hưởng trực tiếp tới việc bao giờ nên đặt lịch.',
                en: 'Point (3) matters: if only 1 attempt is sponsored, a fail comes out of your own pocket, which directly affects when you should book the exam.',
              },
            ],
            doneWhen: {
              vi: 'Có tên trong sheet và biết chính xác email nào dùng để đăng ký.',
              en: 'Your name is on the sheet and you know exactly which email to register with.',
            },
          },
          {
            id: 'w1-0-1',
            title: {
              vi: 'Đăng ký Anthropic Academy (anthropic.skilljar.com) bằng email công ty',
              en: 'Register for Anthropic Academy (anthropic.skilljar.com) with your company email',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Mở {aca|anthropic.skilljar.com} rồi bấm Sign up. <strong>Bắt buộc dùng email công ty</strong> - email cá nhân không vào được Partner Academy và cũng không đăng ký thi được.',
                en: "Open {aca|anthropic.skilljar.com} and click Sign up. <strong>You must use your company email</strong> - a personal email can't access Partner Academy and can't register for the exam either.",
              },
              {
                vi: 'Xác thực email trong hộp thư, đăng nhập lại, vào mục danh sách khoá (Catalog).',
                en: 'Verify the email in your inbox, log back in, and go to the course list (Catalog).',
              },
              {
                vi: 'Bookmark trang này - cả tuần 1 sẽ quay lại mỗi ngày.',
                en: "Bookmark this page - you'll come back to it every day of week 1.",
              },
            ],
            doneWhen: {
              vi: 'Đăng nhập được và nhìn thấy danh sách khoá học.',
              en: 'You can log in and see the course list.',
            },
          },
          {
            id: 'w1-0-2',
            title: {
              vi: 'Tải Exam Guide, đọc mục 1-5: đối tượng, format 60 câu/120 phút/720, blueprint 5 domain, 6 kịch bản',
              en: 'Download the Exam Guide, read sections 1-5: audience, 60-question/120-minute/720 format, the 5-domain blueprint, 6 scenarios',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Tải {guide|Exam Guide PDF} - 39 trang, bản v1.0 tháng 7/2026. Đây là tài liệu chuẩn duy nhất, mọi nguồn khác chỉ là diễn giải lại.',
                en: 'Download the {guide|Exam Guide PDF} - 39 pages, v1.0 from July 2026. This is the only authoritative document; every other source is just a reinterpretation.',
              },
              {
                vi: 'Đọc mục 1-3 (khoảng 5 phút): đối tượng dự thi, format 60 câu / 120 phút / đậu 720.',
                en: 'Read sections 1-3 (about 5 minutes): exam audience, 60 questions / 120 minutes / 720 to pass.',
              },
              {
                vi: 'Đọc mục 4-5 (khoảng 10 phút): bảng trọng số 5 domain và mô tả 6 kịch bản. Chép 6 tên kịch bản ra giấy - đề thi bốc ngẫu nhiên 4 trong 6 cái đó.',
                en: 'Read sections 4-5 (about 10 minutes): the 5-domain weighting table and the descriptions of the 6 scenarios. Write the 6 scenario names down on paper - the exam draws 4 of those 6 at random.',
              },
              {
                vi: '<strong>Chưa đọc mục 6</strong> (task statement chi tiết) - để dành tới khi đã build, đọc bây giờ chắc chắn quên.',
                en: "<strong>Don't read section 6 yet</strong> (the detailed task statements) - save it until you have built something; reading it now means you'll definitely forget it.",
              },
            ],
            doneWhen: {
              vi: 'Đọc vanh vách 5 domain kèm trọng số mà không cần nhìn lại.',
              en: 'You can rattle off the 5 domains with their weights without looking them up.',
            },
          },
        ],
      },
      {
        id: 'w1-1',
        date: '2026-09-05',
        hours: 5,
        title: {
          vi: '12 quy tắc · Đề lạnh · Platform 101',
          en: '12 rules · Cold mock · Platform 101',
        },
        tasks: [
          {
            id: 'w1-1-0',
            title: {
              vi: 'Đọc trang tổng quan nguyenchau.dev + mục "12 Architectural Judgment Rules"',
              en: 'Read the nguyenchau.dev overview page + the "12 Architectural Judgment Rules" section',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Mở {nc|trang CCA-F} rồi kéo tới mục <strong>12 Architectural Judgment Rules</strong>.',
                en: 'Open the {nc|CCA-F page} and scroll to the <strong>12 Architectural Judgment Rules</strong> section.',
              },
              {
                vi: 'Đọc bản đầy đủ ở đó, sau đó đối chiếu với thẻ <em>12 quy tắc phán đoán</em> ở cuối trang này (bản đã tóm gọn để tra nhanh).',
                en: 'Read the full version there, then compare it against the <em>12 judgment rules</em> card at the bottom of this page (a condensed version for quick lookup).',
              },
              {
                vi: 'Đây chính là thứ phân biệt 720 với 800: đề toàn phương án nghe rất hợp lý, quy tắc giúp loại nhanh cái sai.',
                en: 'This is exactly what separates 720 from 800: every option on the exam sounds reasonable, and the rules let you eliminate the wrong ones fast.',
              },
            ],
            doneWhen: {
              vi: 'Giải thích được vì sao dùng hook mạnh hơn viết vào prompt khi cần đảm bảo tuân thủ.',
              en: 'You can explain why a hook is stronger than writing it into the prompt when you need to guarantee compliance.',
            },
          },
          {
            id: 'w1-1-1',
            title: {
              vi: 'Mock <strong>Đề 1</strong> trong tab "Đề thi thử", chế độ 120 phút, chưa học gì - ghi vào Nhật ký bên phải',
              en: 'Take <strong>Mock 1</strong> in the "Practice tests" tab, 120-minute mode, with no studying - record it in the Log on the right',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Mở {mock|tab Đề thi thử}, chọn <strong>Đề 1</strong>, bật chế độ hẹn giờ <strong>120 phút</strong>.',
                en: 'Open the {mock|Practice tests tab}, pick <strong>Mock 1</strong>, and turn on the <strong>120-minute</strong> timer mode.',
              },
              {
                vi: 'Làm nghiêm túc như thi thật: không tra cứu, không dừng giữa chừng. Mục đích là đo điểm xuất phát chứ không phải lấy điểm đẹp.',
                en: 'Take it seriously, like the real exam: no lookups, no pausing halfway. The point is to measure your starting point, not to get a nice score.',
              },
              {
                vi: 'Được 40-55% ở giai đoạn này là bình thường, đừng nản.',
                en: "40-55% is normal at this stage, don't get discouraged.",
              },
              {
                vi: 'Nhập kết quả vào panel <strong>Nhật ký đề thi thử</strong> bên phải: số câu đúng và % từng domain.',
                en: 'Enter the results in the <strong>Practice test log</strong> panel on the right: number correct and the % for each domain.',
              },
            ],
            doneWhen: {
              vi: 'Có 1 dòng trong nhật ký và thấy rõ domain nào thấp nhất.',
              en: "There's 1 row in the log and you can clearly see which domain is lowest.",
            },
          },
          {
            id: 'w1-1-2',
            title: {
              vi: 'Xem lại câu sai theo domain; tự chấm confidence 5 domain lần đầu ở panel Độ sẵn sàng',
              en: 'Review the wrong answers by domain; rate your confidence across the 5 domains for the first time in the Readiness panel',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Đọc giải thích tiếng Việt của <strong>mọi</strong> câu sai - và cả câu đoán mò mà may đúng.',
                en: 'Read the Vietnamese explanation for <strong>every</strong> wrong answer - and for the ones you guessed and happened to get right.',
              },
              {
                vi: 'Với mỗi câu sai, tự phân loại: (a) chưa biết kiến thức, hay (b) biết nhưng dính bẫy. Loại (b) mới là thứ cần luyện nhiều.',
                en: "For each wrong answer, classify it yourself: (a) you didn't know the material, or (b) you knew it but fell for a trap. Type (b) is what needs the most practice.",
              },
              {
                vi: 'Kéo 5 thanh <strong>Độ sẵn sàng theo domain</strong> theo cảm nhận thật: 0 là mù tịt, 5 là dạy lại được cho người khác.',
                en: 'Drag the 5 <strong>Readiness by domain</strong> bars to how you honestly feel: 0 is clueless, 5 is able to teach it to someone else.',
              },
            ],
            doneWhen: {
              vi: '5 thanh đều có giá trị và chốt được 2 domain yếu nhất.',
              en: "All 5 bars have a value and you've settled on your 2 weakest domains.",
            },
          },
          {
            id: 'w1-1-3',
            title: {
              vi: 'Academy: <em>Claude Platform 101</em>',
              en: 'Academy: <em>Claude Platform 101</em>',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Vào {aca|Academy}, tìm khoá <em>Claude Platform 101</em> trong catalog, học hết.',
                en: 'Go to {aca|Academy}, find the <em>Claude Platform 101</em> course in the catalog, and finish it.',
              },
              {
                vi: 'Ghi lại 3 thứ: model nào dùng cho việc gì, các tham số cơ bản, vai trò của system prompt.',
                en: 'Note down 3 things: which model to use for what, the basic parameters, and the role of the system prompt.',
              },
            ],
            doneWhen: {
              vi: 'Hoàn thành khoá và nhận được course certificate đầu tiên.',
              en: "The course is complete and you've received your first course certificate.",
            },
          },
        ],
      },
      {
        id: 'w1-2',
        date: '2026-09-06',
        hours: 3,
        title: {
          vi: 'Vào khoá API · chốt ngày thi',
          en: 'Into the API course · lock the exam date',
        },
        tasks: [
          {
            id: 'w1-2-0',
            title: {
              vi: 'Academy <em>Building with the Claude API</em> - bài <strong>1-12</strong> / 85',
              en: 'Academy <em>Building with the Claude API</em> - lessons <strong>1-12</strong> / 85',
            },
            tags: ['d1', 'd4'],
            steps: [
              {
                vi: 'Mở {aca|Academy} → khoá <em>Building with the Claude API</em>. Bạn đang ở bài 1/85.',
                en: "Open {aca|Academy} → the <em>Building with the Claude API</em> course. You're at lesson 1/85.",
              },
              {
                vi: 'Học tới hết bài 12 (≈1 giờ). Đây là phần mở đầu: cấu trúc request, messages, system prompt - đi nhanh được.',
                en: 'Study through lesson 12 (≈1 hour). This is the opening part: request structure, messages, system prompt - you can move fast.',
              },
              {
                vi: 'Đã muộn thì dừng ở đâu cũng được - phần dư dồn sang mai, mai chỉ nặng thêm vài bài.',
                en: "It's late, so stop wherever you get to - the remainder rolls into tomorrow, which only adds a few lessons.",
              },
            ],
            doneWhen: {
              vi: 'Thanh tiến độ khoá API chạm ≈12/85.',
              en: 'The API course progress bar hits ≈12/85.',
            },
          },
          {
            id: 'w1-2-1',
            title: {
              vi: 'Đổi "Ngày thi dự kiến" trên đầu trang thành <strong>27/09/2026</strong>',
              en: 'Change "Planned exam date" at the top of the page to <strong>27/09/2026</strong>',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Ô <strong>Ngày thi dự kiến</strong> ở khối tiêu đề - bấm vào ngày, chọn 27/09.',
                en: 'The <strong>Planned exam date</strong> field in the header block - click the date and pick 27/09.',
              },
              {
                vi: 'Toàn bộ đếm ngược và ô "Ngày thi" trong Tuần thi sẽ tự đổi theo.',
                en: 'The whole countdown and the "Exam day" field in Exam week will update automatically.',
              },
            ],
            doneWhen: {
              vi: 'Ô đếm ngược hiện "còn 21 ngày".',
              en: 'The countdown shows "21 days left".',
            },
          },
        ],
      },
      {
        id: 'w1-3',
        date: '2026-09-07',
        hours: 3,
        title: {
          vi: 'API bài 13-27 · tool use',
          en: 'API lessons 13-27 · tool use',
        },
        tasks: [
          {
            id: 'w1-3-0',
            title: {
              vi: 'Academy API - bài <strong>13-27</strong> (≈1,5 giờ): tool use, <code>stop_reason</code>',
              en: 'Academy API - lessons <strong>13-27</strong> (≈1.5 hours): tool use, <code>stop_reason</code>',
            },
            tags: ['d1', 'd4'],
            steps: [
              {
                vi: 'Tiếp khoá <em>Building with the Claude API</em>, học ≈15 bài. Canh theo ranh giới section, lệch vài bài không sao.',
                en: 'Continue the <em>Building with the Claude API</em> course, ≈15 lessons. Aim for section boundaries; being a few lessons off is fine.',
              },
              {
                vi: 'Đoạn này là <strong>phần ra đề nhiều nhất</strong>: vòng lặp gọi tool, giá trị <code>stop_reason</code> (<code>tool_use</code> / <code>end_turn</code> / <code>max_tokens</code>), cách nối tool result vào lịch sử.',
                en: 'This stretch is <strong>the most heavily tested part</strong>: the tool-calling loop, the <code>stop_reason</code> values (<code>tool_use</code> / <code>end_turn</code> / <code>max_tokens</code>), and how to append the tool result to the history.',
              },
              {
                vi: 'Mở song song {api|platform.claude.com/docs} phần Tool use nếu video lướt nhanh quá.',
                en: 'Keep {api|platform.claude.com/docs} open alongside on the Tool use section if the video moves too fast.',
              },
            ],
            doneWhen: {
              vi: 'Tự viết ra được vòng lặp agent dừng khi nào mà không nhìn tài liệu.',
              en: 'You can write out the agent loop and when it stops without looking at the docs.',
            },
          },
        ],
      },
      {
        id: 'w1-4',
        date: '2026-09-08',
        hours: 2.5,
        title: {
          vi: 'Domain 1 · đặt lịch Pearson VUE',
          en: 'Domain 1 · book Pearson VUE',
        },
        tasks: [
          {
            id: 'w1-4-0',
            title: {
              vi: 'Đọc lướt {n1|Domain 1 note} (25 phút) - đối chiếu với phần loop vừa học',
              en: 'Skim the {n1|Domain 1 note} (25 minutes) - compare it with the loop you just learned',
            },
            tags: ['d1'],
            steps: [
              {
                vi: 'Domain nặng nhất (27%) và là domain bạn yếu nhất ở Đề 1 (50%). Đọc lướt để biết có gì, chưa cần nhớ.',
                en: "The heaviest domain (27%) and the one you were weakest in on Mock 1 (50%). Skim it to see what's there; no need to memorize yet.",
              },
              {
                vi: 'Đánh dấu chỗ chưa hiểu về Task tool, <code>allowedTools</code>, <code>fork_session</code> - tuần 3 build xong sẽ tự sáng.',
                en: "Mark whatever you don't understand about the Task tool, <code>allowedTools</code>, <code>fork_session</code> - it'll click on its own once you've built things in week 3.",
              },
            ],
            doneWhen: {
              vi: 'Có danh sách 3-5 câu hỏi cụ thể về Domain 1.',
              en: 'You have a list of 3-5 specific questions about Domain 1.',
            },
          },
          {
            id: 'w1-4-1',
            title: {
              vi: 'Đặt lịch Pearson VUE cho <strong>27/09</strong> ngay hôm nay (30 phút)',
              en: 'Book Pearson VUE for <strong>27/09</strong> today (30 minutes)',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Vào Partner Academy → trang chứng chỉ CCAR-F → mua bài thi (giá đã trừ giảm giá theo tier công ty). Làm theo mail hướng dẫn để tạo tài khoản {vue|Pearson VUE}, chọn <strong>27/09</strong>, online proctored hoặc test center.',
                en: "Go to Partner Academy → the CCAR-F certification page → buy the exam (the price already reflects your company's tier discount). Follow the instruction email to create a {vue|Pearson VUE} account, pick <strong>27/09</strong>, online proctored or a test center.",
              },
              {
                vi: 'Đặt sớm vì slot ngày cuối tuần hết nhanh. <strong>Đổi/huỷ miễn phí tới trước 24 giờ</strong> - nên đặt sớm không có rủi ro gì, chỉ có lợi.',
                en: 'Book early because weekend slots fill up fast. <strong>Free reschedule/cancel up to 24 hours before</strong> - so booking early carries no risk, only upside.',
              },
              {
                vi: 'Kiểm tra tên tài khoản Pearson VUE khớp <strong>từng ký tự</strong> với CMND/CCCD/hộ chiếu. Lệch thì email <code>certifications-support@anthropic.com</code> trước khi thi.',
                en: "Check that your Pearson VUE account name matches your ID card/passport <strong>character for character</strong>. If it doesn't, email <code>certifications-support@anthropic.com</code> before the exam.",
              },
            ],
            doneWhen: {
              vi: 'Có email xác nhận lịch thi 27/09, tên khớp giấy tờ.',
              en: 'You have the confirmation email for the 27/09 exam, with the name matching your ID.',
            },
          },
        ],
      },
      {
        id: 'w1-5',
        date: '2026-09-09',
        hours: 3,
        title: {
          vi: 'API bài 28-42 · structured output',
          en: 'API lessons 28-42 · structured output',
        },
        tasks: [
          {
            id: 'w1-5-0',
            title: {
              vi: 'Academy API - bài <strong>28-42</strong> (≈1,5 giờ): structured output, JSON schema, <code>tool_choice</code>',
              en: 'Academy API - lessons <strong>28-42</strong> (≈1.5 hours): structured output, JSON schema, <code>tool_choice</code>',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Học ≈15 bài tiếp. Trọng tâm: ép model trả JSON đúng schema bằng tool_use, ba chế độ <code>tool_choice</code> (<code>auto</code> / <code>any</code> / ép tool cụ thể).',
                en: 'Study the next ≈15 lessons. Focus: forcing the model to return JSON matching a schema via tool_use, and the three <code>tool_choice</code> modes (<code>auto</code> / <code>any</code> / forcing a specific tool).',
              },
              {
                vi: 'Ghi ngay vào note: khi nào dùng <code>any</code>, khi nào ép tool - đề hỏi đúng chỗ này.',
                en: 'Write it into your notes immediately: when to use <code>any</code>, when to force a tool - the exam asks exactly this.',
              },
            ],
            doneWhen: {
              vi: 'Phân biệt được 3 chế độ tool_choice và nói được tình huống dùng.',
              en: 'You can tell the 3 tool_choice modes apart and name a situation for each.',
            },
          },
        ],
      },
      {
        id: 'w1-6',
        date: '2026-09-10',
        hours: 2,
        title: {
          vi: 'Domain 4 · sample 1-6',
          en: 'Domain 4 · samples 1-6',
        },
        tasks: [
          {
            id: 'w1-6-0',
            title: {
              vi: 'Đọc lướt {n4|Domain 4 note} (25 phút)',
              en: 'Skim the {n4|Domain 4 note} (25 minutes)',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Bạn đã 100% domain này ở Đề 1 - chỉ lướt để chắc không có khái niệm lạ, không cần đào.',
                en: "You scored 100% in this domain on Mock 1 - just skim to make sure there's no unfamiliar concept, no need to dig.",
              },
              {
                vi: 'Để ý phần few-shot và validation-retry vì tuần 3 sẽ build đúng thứ đó.',
                en: "Pay attention to the few-shot and validation-retry parts, because you'll be building exactly that in week 3.",
              },
            ],
            doneWhen: {
              vi: 'Không thấy khái niệm nào lạ trong Domain 4.',
              en: 'Nothing in Domain 4 looks unfamiliar.',
            },
          },
          {
            id: 'w1-6-1',
            title: {
              vi: 'Giải <strong>sample question 1-6</strong> trong Exam Guide, che đáp án trước (30 phút)',
              en: 'Work <strong>sample questions 1-6</strong> in the Exam Guide, covering the answers first (30 minutes)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Mở {guide|Exam Guide} mục 9. Che đáp án, tự chọn, rồi mới đọc rationale.',
                en: 'Open {guide|Exam Guide} section 9. Cover the answers, pick your own, and only then read the rationale.',
              },
              {
                vi: 'Với mỗi câu, ghi 1 dòng: quy tắc rút được. 6 câu đầu là kịch bản Customer Support + Code Generation.',
                en: 'For each question, write one line: the rule you derived. The first 6 questions are the Customer Support + Code Generation scenarios.',
              },
            ],
            doneWhen: {
              vi: 'Có 6 dòng quy tắc tự rút.',
              en: 'You have 6 lines of rules you derived yourself.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'w2',
    label: { vi: 'Tuần 2', en: 'Week 2' },
    phase: {
      vi: 'Bắt kịp · khoá ngắn · Ex2',
      en: 'Catch up · short courses · Ex2',
    },
    range: '11-17/09',
    span: 7,
    desc: {
      vi: 'Hai ngày đầu tuần (11-12) là phần đuôi của khối nền tảng, đã xong. Chủ nhật 13/09 là ngày bắt kịp: đóng nốt khoá API, học Subagents và dựng repo lab - sau ngày này lộ trình hết nợ. Các tối 14-17 chỉ ≈3 giờ vì còn đi làm, dành cho ba khoá ngắn về Claude Code và hai bài config gõ thẳng trên máy.',
      en: 'The first two days (11-12) are the tail of the foundations block and are already done. Sunday 13/09 is the catch-up day: finish the API course, take Subagents, and stand up the lab repo - after it the plan owes nothing. Evenings 14-17 are ≈3 hours each because they are work nights, spent on the three short Claude Code courses and two config exercises you do at the keyboard.',
    },
    days: [
      {
        id: 'w2-0',
        date: '2026-09-11',
        hours: 3,
        title: {
          vi: 'API bài 43-57 · batch & context',
          en: 'API lessons 43-57 · batch & context',
        },
        tasks: [
          {
            id: 'w2-0-0',
            title: {
              vi: 'Academy API - bài <strong>43-57</strong> (≈1,5 giờ): Message Batches, context window',
              en: 'Academy API - lessons <strong>43-57</strong> (≈1.5 hours): Message Batches, context window',
            },
            tags: ['d4', 'd5'],
            steps: [
              {
                vi: 'Học ≈15 bài tiếp. Trọng tâm: Batches API (−50% phí, tới 24h, <code>custom_id</code>, không tool multi-turn) và quản lý context.',
                en: 'Study the next ≈15 lessons. Focus: the Batches API (−50% cost, up to 24h, <code>custom_id</code>, no multi-turn tool use) and context management.',
              },
              {
                vi: 'Đề rất hay hỏi "việc nào dùng batch được": ghi ra 2 ví dụ được / 2 ví dụ không được.',
                en: 'The exam loves asking "which task can use batch": write down 2 examples that can and 2 that can\'t.',
              },
            ],
            doneWhen: {
              vi: 'Nói được vì sao pre-merge check không dùng batch còn báo cáo đêm thì được.',
              en: "You can explain why a pre-merge check can't use batch while a nightly report can.",
            },
          },
        ],
      },
      {
        id: 'w2-1',
        date: '2026-09-12',
        hours: 2.5,
        title: {
          vi: 'Domain 5 · sample 7-12 · ngoài phạm vi',
          en: 'Domain 5 · samples 7-12 · out of scope',
        },
        tasks: [
          {
            id: 'w2-1-0',
            title: {
              vi: 'Đọc lướt {n5|Domain 5 note} (25 phút) - domain đòn bẩy',
              en: 'Skim the {n5|Domain 5 note} (25 minutes) - the leverage domain',
            },
            tags: ['d5'],
            steps: [
              {
                vi: 'Đề 1 bạn được 67% ở đây, mục tiêu 85%. Domain này ít câu nhưng ai cũng làm kém, kéo lên được là tổng vọt.',
                en: 'You got 67% here on Mock 1, target 85%. This domain has few questions but everyone does badly on it, so pulling it up lifts the total sharply.',
              },
              {
                vi: 'Để ý: lost-in-the-middle, escalation criteria, error propagation, provenance.',
                en: 'Pay attention to: lost-in-the-middle, escalation criteria, error propagation, provenance.',
              },
            ],
            doneWhen: {
              vi: 'Kể được 6 chủ đề của Domain 5.',
              en: 'You can name the 6 topics of Domain 5.',
            },
          },
          {
            id: 'w2-1-1',
            title: {
              vi: 'Giải <strong>sample 7-12</strong> + đọc In-scope / Out-of-scope (35 phút)',
              en: 'Work <strong>samples 7-12</strong> + read In-scope / Out-of-scope (35 minutes)',
            },
            tags: ['m', 'a'],
            steps: [
              {
                vi: '6 câu còn lại: kịch bản Multi-Agent Research + CI. Che đáp án, chọn, so rationale.',
                en: 'The remaining 6 questions: the Multi-Agent Research + CI scenarios. Cover the answers, pick, then compare with the rationale.',
              },
              {
                vi: 'Mở mục 17 (Appendix): đọc <strong>Out-of-scope</strong> và gạch khỏi đầu - fine-tuning, RLHF, computer use, vision, streaming, rate limit, OAuth, cloud config.',
                en: 'Open section 17 (Appendix): read <strong>Out-of-scope</strong> and strike it from your mind - fine-tuning, RLHF, computer use, vision, streaming, rate limits, OAuth, cloud config.',
              },
              {
                vi: 'So với thẻ <em>Ngoài phạm vi</em> cuối trang này.',
                en: 'Compare against the <em>Out of scope</em> card at the bottom of this page.',
              },
            ],
            doneWhen: {
              vi: 'Đủ 12 dòng quy tắc; biết rõ thứ gì không thi.',
              en: "You have all 12 lines of rules; you know exactly what isn't tested.",
            },
          },
        ],
      },
      {
        id: 'w2-2',
        date: '2026-09-13',
        hours: 8.5,
        title: {
          vi: 'Bắt kịp: đóng khoá API · dựng repo lab',
          en: 'Catch up: close the API course · stand up the lab',
        },
        tasks: [
          {
            id: 'w2-2-0',
            title: {
              vi: 'Academy API - bài <strong>58-72</strong> (≈1,5 giờ)',
              en: 'Academy API - lessons <strong>58-72</strong> (≈1.5 hours)',
            },
            tags: ['d1', 'd4'],
            steps: [
              {
                vi: 'Học ≈15 bài tiếp. Phần này thường là ví dụ ứng dụng / best practice - đi nhanh, nhưng dừng lại ở chỗ nào nhắc <code>stop_reason</code> hay error handling.',
                en: 'Study the next ≈15 lessons. This part is usually application examples / best practices - move fast, but stop anywhere <code>stop_reason</code> or error handling comes up.',
              },
            ],
            doneWhen: {
              vi: 'Khoá API chạm ≈72/85.',
              en: 'The API course hits ≈72/85.',
            },
          },
          {
            id: 'w2-2-1',
            title: {
              vi: 'Academy API - bài <strong>73-85</strong>, <strong>hoàn thành khoá</strong> (≈1,2 giờ)',
              en: 'Academy API - lessons <strong>73-85</strong>, <strong>finish the course</strong> (≈1.2 hours)',
            },
            tags: ['d1', 'd4'],
            steps: [
              {
                vi: 'Học nốt 13 bài cuối, lấy certificate, bấm "Add to profile" nếu muốn.',
                en: 'Work through the last 13 lessons, get the certificate, click "Add to profile" if you want.',
              },
              {
                vi: 'Xong khoá này là xong 60% khối lượng Academy.',
                en: 'Finishing this course clears 60% of the Academy workload.',
              },
            ],
            doneWhen: {
              vi: 'Certificate <em>Building with the Claude API</em> hiện trong Registrations.',
              en: 'The <em>Building with the Claude API</em> certificate shows up in Registrations.',
            },
          },
          {
            id: 'w2-2-2',
            title: {
              vi: 'Academy <em>Introduction to Subagents</em> - 4 bài (30 phút)',
              en: 'Academy <em>Introduction to Subagents</em> - 4 lessons (30 min)',
            },
            tags: ['d1'],
            steps: [
              {
                vi: 'Khoá ngắn. Ghi kỹ một câu: subagent <strong>không</strong> tự thừa kế context của agent cha - phải truyền trong prompt.',
                en: "Short course. Write down one sentence carefully: a subagent does <strong>not</strong> inherit the parent agent's context - you have to pass it in the prompt.",
              },
              {
                vi: 'Đây là câu hỏi kinh điển và cũng là nền của Ex4.',
                en: 'This is a classic exam question and also the foundation of Ex4.',
              },
            ],
            doneWhen: {
              vi: 'Nói được subagent nhận context bằng cách nào.',
              en: 'You can explain how a subagent receives context.',
            },
          },
          {
            id: 'w2-2-3',
            title: {
              vi: 'Đọc lướt {n2|Domain 2 note} (25 phút) - domain yếu thứ 2',
              en: 'Skim the {n2|Domain 2 note} (25 minutes) - your 2nd weakest domain',
            },
            tags: ['d2'],
            steps: [
              {
                vi: 'Đề 1 bạn được 55% ở đây. Để ý riêng phần <strong>mô tả tool</strong>: mô tả kém là nguyên nhân số 1 khiến agent gọi sai tool.',
                en: 'You got 55% here on Mock 1. Pay special attention to <strong>tool descriptions</strong>: a poor description is the number 1 reason an agent calls the wrong tool.',
              },
              {
                vi: 'Ghi ra một mô tả tool tốt gồm những gì - thứ Bảy 19/09 sẽ tự viết 4 tool.',
                en: "Write down what a good tool description contains - on Saturday 19/09 you'll write 4 tools yourself.",
              },
            ],
            doneWhen: {
              vi: 'Kể được 4 thành phần của một mô tả tool tốt.',
              en: 'You can name the 4 components of a good tool description.',
            },
          },
          {
            id: 'w2-2-4',
            title: {
              vi: 'Dựng repo <code>ccaf-lab</code>, cài Agent SDK, chạy "hello agent" (35 phút)',
              en: 'Set up the <code>ccaf-lab</code> repo, install the Agent SDK, run "hello agent" (35 minutes)',
            },
            tags: ['d1'],
            steps: [
              {
                vi: 'Tạo repo mới. Chọn <strong>một</strong> ngôn ngữ theo suốt: Python hoặc TypeScript.',
                en: 'Create a new repo. Pick <strong>one</strong> language and stick with it: Python or TypeScript.',
              },
              {
                vi: 'Cài theo lệnh bên dưới. Lấy API key trong console, đặt vào <code>ANTHROPIC_API_KEY</code>, <strong>đừng commit</strong>.',
                en: "Install using the commands below. Get an API key from the console, put it in <code>ANTHROPIC_API_KEY</code>, and <strong>don't commit it</strong>.",
              },
              {
                vi: 'Chạy một agent tối giản gọi được 1 tool. Đây là nền cho mọi exercise về sau.',
                en: 'Run a minimal agent that can call 1 tool. This is the foundation for every exercise that follows.',
              },
            ],
            doneWhen: {
              vi: 'Hello agent chạy. Từ tối mai repo này là chỗ gõ theo khoá Claude Code; build agent thật bắt đầu thứ Bảy 19/09.',
              en: 'Hello agent runs. From tomorrow evening this repo is where you type along with the Claude Code courses; the real agent build starts on Saturday 19/09.',
            },
            code: 'pip install claude-agent-sdk anthropic\n# hoặc\nnpm i @anthropic-ai/claude-agent-sdk @anthropic-ai/sdk',
          },
          {
            id: 'w2-2-5',
            title: {
              vi: 'Cập nhật 5 thanh confidence; ghi 3 điều còn mơ hồ vào README repo lab (20 phút)',
              en: 'Update the 5 confidence bars; write 3 things still unclear into the lab repo README (20 min)',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'So với lần chấm 05/09 - domain nào không nhúc nhích thì tuần 3 ưu tiên.',
                en: "Compare against the 05/09 scoring - any domain that hasn't moved gets priority in week 3.",
              },
              {
                vi: 'Viết 3 câu hỏi cụ thể còn lấn cấn (vd: hook chạy lúc nào? subagent trả kết quả ra sao?). Build xong Ex1 ngày 20/09 phải tự trả lời được.',
                en: "Write 3 specific questions that still nag you (e.g. when does a hook run? how does a subagent return results?). Once Ex1 is built on 20/09 you must be able to answer them yourself.",
              },
            ],
            doneWhen: {
              vi: 'Confidence đã cập nhật, README có 3 câu hỏi.',
              en: 'Confidence updated, README has the 3 questions.',
            },
          },
        ],
      },
      {
        id: 'w2-3',
        date: '2026-09-14',
        hours: 3.5,
        title: {
          vi: 'Claude Code 101 · Agent Skills',
          en: 'Claude Code 101 · Agent Skills',
        },
        tasks: [
          {
            id: 'w2-3-0',
            title: {
              vi: 'Academy <em>Claude Code 101</em> - 13 bài (≈1,3 giờ), vừa học vừa gõ theo trên repo thật',
              en: 'Academy <em>Claude Code 101</em> - 13 lessons (≈1.3 hours), typing along on a real repo',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Mở terminal song song, gõ theo từng lệnh trên repo <code>ccaf-lab</code> - xem suông sẽ không nhớ.',
                en: "Keep a terminal open alongside and type every command against the <code>ccaf-lab</code> repo - just watching won't stick.",
              },
              {
                vi: 'Tra {cc|code.claude.com/docs} khi gặp lệnh lạ.',
                en: 'Look up {cc|code.claude.com/docs} whenever you hit an unfamiliar command.',
              },
            ],
            doneWhen: {
              vi: 'Chạy được Claude Code trên repo và hiểu lệnh cơ bản.',
              en: 'You can run Claude Code on the repo and understand the basic commands.',
            },
          },
          {
            id: 'w2-3-1',
            title: {
              vi: 'Academy <em>Introduction to Agent Skills</em> - 6 bài (40 phút)',
              en: 'Academy <em>Introduction to Agent Skills</em> - 6 lessons (40 min)',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Để ý frontmatter: <code>context: fork</code>, <code>allowed-tools</code>, <code>argument-hint</code> - tối thứ Tư 16/09 sẽ tự viết một skill.',
                en: "Note the frontmatter: <code>context: fork</code>, <code>allowed-tools</code>, <code>argument-hint</code> - on Wednesday evening the 16th you'll write a skill yourself.",
              },
            ],
            doneWhen: {
              vi: 'Kể được 3 trường frontmatter của SKILL.md và tác dụng.',
              en: 'You can name 3 SKILL.md frontmatter fields and what they do.',
            },
          },
        ],
      },
      {
        id: 'w2-4',
        date: '2026-09-15',
        hours: 2,
        title: {
          vi: 'Claude Code in Action · Domain 3',
          en: 'Claude Code in Action · Domain 3',
        },
        tasks: [
          {
            id: 'w2-4-0',
            title: {
              vi: 'Academy <em>Claude Code in Action</em> - 10 bài (≈1,2 giờ)',
              en: 'Academy <em>Claude Code in Action</em> - 10 lessons (≈1.2 hours)',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Học hết, chú ý phần plan mode và cách làm việc với codebase lớn.',
                en: 'Work through all of it; pay attention to plan mode and working with large codebases.',
              },
            ],
            doneWhen: {
              vi: 'Xong khoá, còn 2 khoá MCP để dành cho cuối tuần 19-20/09.',
              en: 'Course done; the 2 MCP courses are left for the weekend of 19-20/09.',
            },
          },
          {
            id: 'w2-4-1',
            title: {
              vi: 'Đọc lướt {n3|Domain 3 note} (25 phút)',
              en: 'Skim the {n3|Domain 3 notes} (25 min)',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Domain 20%. Đọc để biết Claude Code có mấy tầng cấu hình và chúng khác nhau ra sao.',
                en: 'This domain is 20%. Read it to learn how many configuration layers Claude Code has and how they differ.',
              },
              {
                vi: 'Đánh dấu 3 chỗ lạ nhất - Ex2 sẽ đụng hết.',
                en: 'Mark the 3 most unfamiliar spots - Ex2 will hit all of them.',
              },
            ],
            doneWhen: {
              vi: 'Kể được 3 tầng CLAUDE.md và ai nhìn thấy tầng nào.',
              en: 'You can name the 3 CLAUDE.md layers and who sees which.',
            },
          },
        ],
      },
      {
        id: 'w2-5',
        date: '2026-09-16',
        hours: 3.5,
        title: {
          vi: 'Ex2a CLAUDE.md · Ex2c skill & plan mode',
          en: 'Ex2a CLAUDE.md · Ex2c skills & plan mode',
        },
        tasks: [
          {
            id: 'w2-5-0',
            title: {
              vi: 'Ex2a: CLAUDE.md cấp project + <code>@import</code> + <code>.claude/rules/</code> glob; soi lại setup của chính mình (1,2 giờ)',
              en: 'Ex2a: project-level CLAUDE.md + <code>@import</code> + <code>.claude/rules/</code> globs; audit your own setup (1.2 hours)',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Trước hết chạy <code>/memory</code> trên project đang làm để thấy thật sự file nào đang nạp. Liệt kê thứ mình chưa từng dùng.',
                en: "First run <code>/memory</code> on the project you're working on to see which files are actually loaded. List the ones you've never used.",
              },
              {
                vi: 'Tạo <code>CLAUDE.md</code> gốc với chuẩn chung; tách chuẩn từng package ra file riêng rồi <code>@import</code>.',
                en: 'Create a root <code>CLAUDE.md</code> with the shared conventions; split the per-package conventions into separate files and <code>@import</code> them.',
              },
              {
                vi: 'Tạo <code>.claude/rules/api.md</code> (<code>paths: ["src/api/**/*"]</code>) và <code>testing.md</code> (<code>paths: ["**/*.test.*"]</code>). Kiểm chứng rule chỉ nạp khi sửa file khớp.',
                en: 'Create <code>.claude/rules/api.md</code> (<code>paths: ["src/api/**/*"]</code>) and <code>testing.md</code> (<code>paths: ["**/*.test.*"]</code>). Verify a rule loads only when you edit a matching file.',
              },
              {
                vi: 'Bẫy kinh điển: đồng nghiệp không nhận quy ước vì để ở <code>~/.claude/CLAUDE.md</code> (tầng user) thay vì project.',
                en: 'Classic trap: teammates never get the conventions because they sit in <code>~/.claude/CLAUDE.md</code> (user layer) instead of the project.',
              },
            ],
            doneWhen: {
              vi: '<code>/memory</code> hiện đúng file mong đợi; rule glob chỉ xuất hiện khi khớp.',
              en: '<code>/memory</code> shows exactly the expected files; glob rules appear only on a match.',
            },
            code: '---\npaths: ["**/*.test.*"]\n---\nQuy ước viết test cho repo này...',
          },
          {
            id: 'w2-5-1',
            title: {
              vi: 'Ex2c: skill <code>context: fork</code> + <code>allowed-tools</code> + <code>argument-hint</code>; thử plan mode vs direct với 3 task (1,5 giờ)',
              en: 'Ex2c: a skill with <code>context: fork</code> + <code>allowed-tools</code> + <code>argument-hint</code>; try plan mode vs direct on 3 tasks (1.5 hours)',
            },
            tags: ['d3'],
            steps: [
              {
                vi: 'Tạo <code>.claude/skills/&lt;tên&gt;/SKILL.md</code>. Cho skill làm việc ồn ào (quét codebase) → output <strong>không</strong> tràn vào hội thoại chính.',
                en: 'Create <code>.claude/skills/&lt;tên&gt;/SKILL.md</code>. Give the skill a noisy job (scanning the codebase) → its output must <strong>not</strong> spill into the main conversation.',
              },
              {
                vi: '3 task: (1) fix 1 file có stack trace, (2) migrate thư viện nhiều file, (3) feature nhiều cách làm. Mỗi task thử cả plan mode và direct, ghi lại cái nào hợp.',
                en: '3 tasks: (1) fix one file from a stack trace, (2) a multi-file library migration, (3) a feature with several possible approaches. Try both plan mode and direct on each, and log which one fits.',
              },
              {
                vi: 'Kết luận: plan mode cho việc kiến trúc / nhiều file / nhiều cách; direct cho việc nhỏ rõ phạm vi.',
                en: 'Conclusion: plan mode for architectural / multi-file / multi-approach work; direct for small, clearly scoped tasks.',
              },
            ],
            doneWhen: {
              vi: 'Trả lời ngay được "tái cấu trúc sang microservice thì chọn gì".',
              en: 'You can answer "which one for refactoring into microservices" on the spot.',
            },
          },
        ],
      },
      {
        id: 'w2-6',
        date: '2026-09-17',
        hours: 3,
        title: {
          vi: 'Task statement Domain 3 · Ex3a extraction',
          en: 'Domain 3 task statements · Ex3a extraction',
        },
        tasks: [
          {
            id: 'w2-6-0',
            title: {
              vi: 'Đọc task <strong>3.1-3.5 và 2.4-2.5</strong> đối chiếu với Ex2 (45 phút)',
              en: 'Read tasks <strong>3.1-3.5 and 2.4-2.5</strong> against Ex2 (45 min)',
            },
            tags: ['d3', 'd2'],
            steps: [
              {
                vi: 'Hierarchy, commands/skills, rules glob, plan mode, iterative refinement, MCP scoping, built-in tools (Grep/Glob/Read/Edit).',
                en: 'Hierarchy, commands/skills, rules globs, plan mode, iterative refinement, MCP scoping, built-in tools (Grep/Glob/Read/Edit).',
              },
              {
                vi: 'Dòng nào chưa làm - bổ sung vào repo lab ngay.',
                en: 'Any line not done - add it to the lab repo now.',
              },
            ],
            doneWhen: {
              vi: 'Không còn dòng nào trong 3.1-3.5 đọc thấy lạ.',
              en: 'No line in 3.1-3.5 still reads as unfamiliar.',
            },
          },
          {
            id: 'w2-6-1',
            title: {
              vi: 'Ex3a: extraction tool với schema đủ 4 kiểu trường; so <code>tool_choice: "any"</code> vs ép tool; test tài liệu thiếu trường (2 giờ)',
              en: 'Ex3a: extraction tool with a schema covering all 4 field kinds; compare <code>tool_choice: "any"</code> vs forcing the tool; test documents with missing fields (2 hours)',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Theo Exercise 3. Schema có: bắt buộc, tuỳ chọn, <strong>nullable</strong>, enum + <code>"other"</code> + detail, giá trị <code>"unclear"</code>.',
                en: 'Follow Exercise 3. The schema must have: required, optional, <strong>nullable</strong>, enum + <code>"other"</code> + detail, and an <code>"unclear"</code> value.',
              },
              {
                vi: 'Chạy <code>tool_choice: "any"</code>, rồi ép <code>{"type":"tool","name":"extract_metadata"}</code>. Ghi khác biệt.',
                en: 'Run <code>tool_choice: "any"</code>, then force <code>{"type":"tool","name":"extract_metadata"}</code>. Note the difference.',
              },
              {
                vi: 'Đưa tài liệu <strong>cố tình thiếu</strong> trường → model phải trả <code>null</code>, không bịa. Bịa thì sửa thành nullable.',
                en: 'Feed in a document that is <strong>deliberately missing</strong> a field → the model must return <code>null</code>, not make something up. If it invents a value, make the field nullable.',
              },
            ],
            doneWhen: {
              vi: 'Null 5/5 lần cho trường không có trong nguồn.',
              en: 'Null 5/5 times for a field that is not in the source.',
            },
            code: 'tool_choice = {"type": "tool", "name": "extract_metadata"}',
          },
        ],
      },
    ],
  },
  {
    id: 'w3',
    label: { vi: 'Tuần 3', en: 'Week 3' },
    phase: {
      vi: 'Cuối tuần build · Ex1-Ex4 · Đề 2-3',
      en: 'Build weekend · Ex1-Ex4 · Mocks 2-3',
    },
    range: '18-24/09',
    span: 7,
    desc: {
      vi: 'Tuần nặng nhất, ≈34 giờ. Đề 2 tối thứ Sáu 18, rồi 19 và 20 là cuối tuần cuối cùng còn build được - cả Exercise 1, hai khoá MCP, Ex2b và Đề 3 dồn vào hai ngày đó. Từ 21 đến 24 chỉ còn các tối đi làm ≈3 giờ: Ex3b, Ex3c, Ex4a, Ex4b và đọc nốt 29 task statement.',
      en: 'The heaviest week, ≈34 hours. Mock 2 on Friday evening the 18th, then the 19th and 20th are the last weekend with room to build in - all of Exercise 1, both MCP courses, Ex2b and Mock 3 land on those two days. From the 21st to the 24th there are only ≈3-hour work nights: Ex3b, Ex3c, Ex4a, Ex4b, and the last of the 29 task statements.',
    },
    days: [
      {
        id: 'w3-0',
        date: '2026-09-18',
        hours: 3,
        title: {
          vi: 'Mock Đề 2 - lần timed đầu sau khi học',
          en: 'Mock 2 - first timed run after studying',
        },
        tasks: [
          {
            id: 'w3-0-0',
            title: {
              vi: 'Đọc task <strong>4.3</strong> đối chiếu (20 phút)',
              en: 'Read task <strong>4.3</strong> and cross-check against it (20 minutes)',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Structured output qua tool_use, schema design, nullable để chống bịa. Dòng nào chưa làm - sửa.',
                en: 'Structured output via tool_use, schema design, nullable to prevent fabrication. Any line you have not implemented - fix it.',
              },
            ],
            doneWhen: {
              vi: 'Task 4.3 khớp hoàn toàn với code.',
              en: 'Task 4.3 matches the code exactly.',
            },
          },
          {
            id: 'w3-0-1',
            title: {
              vi: 'Mock <strong>Đề 2</strong> timed 120 phút - <strong>không F5, không rời tab</strong> tới màn hình kết quả (2 giờ)',
              en: 'Mock <strong>2</strong>, timed 120 minutes - <strong>no refresh, do not leave the tab</strong> until the results screen (2 hours)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Tool đề thi thử <strong>không lưu đáp án</strong> - reload là mất hết (đã kiểm chứng). Làm một mạch.',
                en: 'The practice test tool <strong>does not save answers</strong> - a reload wipes everything (verified). Do it in one sitting.',
              },
              {
                vi: 'Canh nhịp: 15 câu / ≈30 phút. Câu mơ hồ flag, đi tiếp.',
                en: 'Keep the pace: 15 questions / ≈30 minutes. Flag ambiguous questions and move on.',
              },
              {
                vi: 'Ghi kết quả + % từng domain vào nhật ký.',
                en: 'Record the result + per-domain % in the log.',
              },
            ],
            doneWhen: {
              vi: 'Dòng thứ 2 trong nhật ký; so với baseline 68%.',
              en: 'Second line in the log; compare against the 68% baseline.',
            },
          },
          {
            id: 'w3-0-2',
            title: {
              vi: 'Review Đề 2: mỗi câu sai ghi vi phạm quy tắc số mấy (45 phút)',
              en: 'Review Mock 2: for every wrong answer, note which rule number you broke (45 minutes)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Không học thuộc đáp án. 3 câu sai cùng một quy tắc = lỗ hổng thật → đánh dấu để 26/09 đào.',
                en: 'Do not memorize answers. 3 wrong answers from the same rule = a real gap → mark it to dig into on 26/09.',
              },
            ],
            doneWhen: {
              vi: 'Có bảng "quy tắc nào hay vi phạm".',
              en: 'You have a table of "which rules you break most".',
            },
          },
        ],
      },
      {
        id: 'w3-1',
        date: '2026-09-19',
        hours: 10,
        title: {
          vi: 'Ngày build 1: MCP · Exercise 1',
          en: 'Build day 1: MCP · Exercise 1',
        },
        tasks: [
          {
            id: 'w3-1-0',
            title: {
              vi: 'Academy <em>Introduction to MCP</em> - 14 bài (≈1,5 giờ)',
              en: 'Academy <em>Introduction to MCP</em> - 14 lessons (≈1.5 hours)',
            },
            tags: ['d2'],
            steps: [
              {
                vi: 'Học hết. Phân biệt <strong>tool</strong> (hành động) và <strong>resource</strong> (catalog nội dung) - đề hay hỏi khi nào dùng cái nào.',
                en: 'Work through all of it. Distinguish a <strong>tool</strong> (an action) from a <strong>resource</strong> (a content catalog) - the exam often asks when to use which.',
              },
              {
                vi: 'Để ý cờ <code>isError</code> - chiều nay sẽ dùng.',
                en: "Note the <code>isError</code> flag - you'll use it this afternoon.",
              },
            ],
            doneWhen: {
              vi: 'Nói được MCP server cung cấp gì cho agent.',
              en: 'You can state what an MCP server provides to an agent.',
            },
          },
          {
            id: 'w3-1-1',
            title: {
              vi: 'Ex1a: 4 MCP tool có mô tả phân biệt rõ + agentic loop theo <code>stop_reason</code> (2,5 giờ)',
              en: 'Ex1a: 4 MCP tools with clearly distinguishing descriptions + an agentic loop driven by <code>stop_reason</code> (2.5 hours)',
            },
            tags: ['d2', 'd1'],
            steps: [
              {
                vi: 'Theo Exercise 1 trong {guide|Exam Guide} mục 8. Định nghĩa <code>get_customer</code>, <code>lookup_order</code>, <code>process_refund</code>, <code>escalate_to_human</code>.',
                en: 'Follow Exercise 1 in the {guide|Exam Guide}, section 8. Define <code>get_customer</code>, <code>lookup_order</code>, <code>process_refund</code>, <code>escalate_to_human</code>.',
              },
              {
                vi: 'Mỗi mô tả đủ: làm gì, định dạng input, ví dụ truy vấn, trường hợp biên, <strong>khi nào dùng nó thay vì tool tương tự</strong>. Cố ý để 2 tool đầu gần giống nhau.',
                en: 'Each description must cover: what it does, input format, example queries, edge cases, <strong>when to use it instead of a similar tool</strong>. Deliberately make the first 2 tools nearly identical.',
              },
              {
                vi: 'Viết vòng lặp: <code>tool_use</code> → chạy tool, nối kết quả, gọi tiếp; <code>end_turn</code> → dừng. Không đếm vòng làm điều kiện dừng, không kiểm tra text để đoán xong.',
                en: "Write the loop: <code>tool_use</code> → run the tool, append the result, call again; <code>end_turn</code> → stop. Don't use a loop counter as the stop condition, and don't inspect the text to guess it's done.",
              },
              {
                vi: 'Hỏi agent kiểu mơ hồ ("kiểm tra đơn #12345 của tôi") 5 lần - gọi sai thì <strong>sửa mô tả</strong>, đừng vội few-shot.',
                en: 'Ask the agent ambiguous questions ("check my order #12345") 5 times - if it calls the wrong tool, <strong>fix the description</strong>, don\'t jump to few-shot.',
              },
            ],
            doneWhen: {
              vi: 'Agent gọi đúng tool 5/5 câu mơ hồ; loop tự dừng đúng lúc.',
              en: 'The agent picks the right tool on 5/5 ambiguous questions; the loop stops on its own at the right point.',
            },
            code: 'while True:\n    resp = client.messages.create(...)\n    if resp.stop_reason == "tool_use":\n        results = run_tools(resp)\n        messages.append(results)   # nối vào lịch sử\n        continue\n    if resp.stop_reason == "end_turn":\n        break',
          },
          {
            id: 'w3-1-2',
            title: {
              vi: 'Đọc task statement <strong>1.1 và 2.1</strong> trong Exam Guide mục 6, đối chiếu với thứ vừa build (30 phút)',
              en: 'Read task statements <strong>1.1 and 2.1</strong> in Exam Guide section 6 and check them against what you just built (30 min)',
            },
            tags: ['d1', 'd2'],
            steps: [
              {
                vi: 'Đọc cả "Knowledge of" và "Skills in". Với mỗi dòng, tự hỏi: code mình vừa viết có làm đúng vậy không?',
                en: 'Read both "Knowledge of" and "Skills in". For each line, ask yourself: does the code you just wrote actually do that?',
              },
              {
                vi: 'Dòng nào chưa - sửa code ngay, đừng để sang ngày khác.',
                en: "Any line it doesn't - fix the code now, don't leave it for another day.",
              },
            ],
            doneWhen: {
              vi: 'Không còn dòng nào trong 1.1 / 2.1 đọc thấy lạ.',
              en: 'No line in 1.1 / 2.1 still reads as unfamiliar.',
            },
          },
          {
            id: 'w3-1-3',
            title: {
              vi: 'Tool trả lỗi có cấu trúc: <code>errorCategory</code>, <code>isRetryable</code>, mô tả cho khách; test 4 loại lỗi (1,2 giờ)',
              en: 'Tools return structured errors: <code>errorCategory</code>, <code>isRetryable</code>, a customer-facing description; test 4 error types (1.2 hours)',
            },
            tags: ['d2', 'd5'],
            steps: [
              {
                vi: 'Mỗi tool khi lỗi trả về: <code>errorCategory</code> (transient / validation / business / permission), <code>isRetryable</code>, mô tả đọc được.',
                en: 'On failure every tool returns: <code>errorCategory</code> (transient / validation / business / permission), <code>isRetryable</code>, and a readable description.',
              },
              {
                vi: 'Test 4 tình huống: timeout (retry được), sai input, vi phạm chính sách hoàn tiền (<code>isRetryable:false</code>), thiếu quyền.',
                en: 'Test 4 situations: timeout (retryable), bad input, refund policy violation (<code>isRetryable:false</code>), missing permission.',
              },
              {
                vi: 'Agent phải phản ứng khác nhau: retry lỗi tạm, giải thích lỗi business chứ không thử lại.',
                en: 'The agent must react differently: retry transient errors, explain business errors instead of retrying.',
              },
            ],
            doneWhen: {
              vi: 'Agent xử lý đúng cả 4 loại lỗi.',
              en: 'The agent handles all 4 error types correctly.',
            },
          },
          {
            id: 'w3-1-4',
            title: {
              vi: 'Hook chặn <code>process_refund</code> > $500 → escalation; prerequisite chặn refund khi chưa có customer ID (1,5 giờ)',
              en: 'Hook blocks <code>process_refund</code> > $500 → escalation; prerequisite blocks a refund while there is no customer ID (1.5 hours)',
            },
            tags: ['d1'],
            steps: [
              {
                vi: 'Viết hook chặn tool call vượt $500, chuyển sang luồng escalate.',
                en: 'Write a hook that blocks any tool call over $500 and routes it into the escalation flow.',
              },
              {
                vi: 'Viết prerequisite: chưa có customer ID từ <code>get_customer</code> thì <code>process_refund</code> không chạy.',
                en: 'Write the prerequisite: without a customer ID from <code>get_customer</code>, <code>process_refund</code> does not run.',
              },
              {
                vi: 'Bảo agent hoàn $600 - phải bị chặn <strong>bằng code</strong>, không phải nhờ prompt xin nó đừng làm. Đây là câu số 1 sample question và là nguyên tắc số 1 cả kỳ thi.',
                en: 'Tell the agent to refund $600 - it must be blocked <strong>in code</strong>, not by a prompt asking it nicely not to. This is sample question number 1 and the number one principle of the whole exam.',
              },
            ],
            doneWhen: {
              vi: 'Hoàn $600 bị chặn 10/10 lần kể cả khi cố dụ.',
              en: 'The $600 refund is blocked 10/10 times, even when you try to talk it into it.',
            },
          },
        ],
      },
      {
        id: 'w3-2',
        date: '2026-09-20',
        hours: 9.5,
        title: {
          vi: 'Ngày build 2: Ex1b · MCP Advanced · Đề 3',
          en: 'Build day 2: Ex1b · MCP Advanced · Mock 3',
        },
        tasks: [
          {
            id: 'w3-2-0',
            title: {
              vi: 'PostToolUse hook chuẩn hoá dữ liệu + test tin nhắn 3 vấn đề + handoff summary (1,5 giờ)',
              en: 'PostToolUse hook normalizes data + test a 3-issue message + handoff summary (1.5 hours)',
            },
            tags: ['d1', 'd5'],
            steps: [
              {
                vi: '2 tool trả thời gian khác định dạng (Unix vs ISO 8601) → hook <code>PostToolUse</code> quy về một kiểu <strong>trước khi</strong> model thấy.',
                en: '2 tools return timestamps in different formats (Unix vs ISO 8601) → a <code>PostToolUse</code> hook normalizes them to one format <strong>before</strong> the model sees them.',
              },
              {
                vi: 'Gửi 1 tin nhắn có 3 vấn đề (đơn hàng + phí ship + hoàn tiền): agent tách ý, xử lý, trả <strong>một</strong> câu trả lời không sót.',
                en: 'Send one message containing 3 issues (order + shipping fee + refund): the agent splits them out, handles them, and returns <strong>one</strong> answer that misses nothing.',
              },
              {
                vi: 'Khi escalate: kèm tóm tắt customer ID, nguyên nhân gốc, đề xuất - người nhận không đọc được lịch sử chat.',
                en: 'On escalation: include a summary with the customer ID, root cause, and a recommendation - the recipient cannot read the chat history.',
              },
            ],
            doneWhen: {
              vi: 'Cả 3 vấn đề được trả lời; bản handoff đủ để người khác xử lý tiếp.',
              en: 'All 3 issues are answered; the handoff is enough for someone else to take over.',
            },
          },
          {
            id: 'w3-2-1',
            title: {
              vi: 'Đọc task <strong>1.4, 1.5, 2.2, 2.3, 5.2</strong> đối chiếu (45 phút)',
              en: 'Read tasks <strong>1.4, 1.5, 2.2, 2.3, 5.2</strong> and cross-check (45 min)',
            },
            tags: ['d1', 'd2', 'd5'],
            steps: [
              {
                vi: 'Đúng 5 task statement mà Ex1b chạm vào: enforcement/handoff, hooks, structured error, tool distribution, escalation.',
                en: 'Exactly the 5 task statements Ex1b touches: enforcement/handoff, hooks, structured errors, tool distribution, escalation.',
              },
              {
                vi: 'Dòng nào code chưa làm - sửa ngay.',
                en: "Any line the code doesn't do - fix it now.",
              },
            ],
            doneWhen: {
              vi: 'Trả lời được 3 câu hỏi mơ hồ đã ghi hôm 13/09 (ít nhất 2/3).',
              en: 'You can answer the 3 unclear questions written down on 13/09 (at least 2 of 3).',
            },
          },
          {
            id: 'w3-2-2',
            title: {
              vi: 'Academy <em>MCP: Advanced Topics</em> - 15 bài (≈1,8 giờ) - <strong>khoá Academy cuối cùng</strong>',
              en: 'Academy <em>MCP: Advanced Topics</em> - 15 lessons (≈1.8 hours) - <strong>the last Academy course</strong>',
            },
            tags: ['d2'],
            steps: [
              {
                vi: 'Trọng tâm: MCP resources (catalog nội dung để giảm tool call thăm dò), scoping project vs user, env var.',
                en: 'Focus: MCP resources (a content catalog that cuts exploratory tool calls), project vs user scoping, env vars.',
              },
              {
                vi: 'Xong khoá này là sạch 7 khoá Academy.',
                en: 'Finishing this course clears all 7 Academy courses.',
              },
            ],
            doneWhen: {
              vi: 'Registrations hiện đủ 8 khoá hoàn thành.',
              en: 'Registrations shows all 8 courses completed.',
            },
          },
          {
            id: 'w3-2-3',
            title: {
              vi: 'Ex2b: <code>.mcp.json</code> project với <code>${GITHUB_TOKEN}</code> + server cá nhân trong <code>~/.claude.json</code> (40 phút)',
              en: 'Ex2b: project <code>.mcp.json</code> with <code>${GITHUB_TOKEN}</code> + a personal server in <code>~/.claude.json</code> (40 min)',
            },
            tags: ['d2', 'd3'],
            steps: [
              {
                vi: 'Server dùng chung → <code>.mcp.json</code> ở project, token qua <code>${VAR}</code>, commit được.',
                en: 'Shared servers → <code>.mcp.json</code> in the project, token via <code>${VAR}</code>, safe to commit.',
              },
              {
                vi: 'Server cá nhân/thử nghiệm → <code>~/.claude.json</code>.',
                en: 'Personal/experimental servers → <code>~/.claude.json</code>.',
              },
              {
                vi: 'Khởi động lại, xác nhận tool của <strong>cả hai</strong> server cùng xuất hiện.',
                en: 'Restart and confirm the tools from <strong>both</strong> servers show up together.',
              },
            ],
            doneWhen: {
              vi: 'Hai nhóm tool cùng hiện; repo không chứa token.',
              en: 'Both tool groups appear; the repo holds no token.',
            },
          },
          {
            id: 'w3-2-4',
            title: {
              vi: 'Mock <strong>Đề 3</strong> timed 120 phút - một mạch tới màn kết quả (2 giờ)',
              en: 'Mock <strong>3</strong>, timed 120 minutes - one sitting through to the results screen (2 hours)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Không F5. 15 câu / 30 phút. Ghi nhật ký kèm % domain.',
                en: 'No refresh. 15 questions / 30 minutes. Log it with per-domain %.',
              },
            ],
            doneWhen: {
              vi: 'Dòng thứ 3 trong nhật ký.',
              en: 'Third line in the log.',
            },
          },
          {
            id: 'w3-2-5',
            title: {
              vi: 'Review Đề 3 + so % domain với 5 thanh confidence (30 phút)',
              en: 'Review Mock 3 + compare per-domain % against the 5 confidence bars (30 minutes)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Sai câu nào ghi quy tắc vi phạm. Chỗ % thật lệch nhiều so với confidence tự chấm = bạn đang tự đánh giá sai - chỉnh thanh.',
                en: 'For every wrong answer, note the rule you broke. Where the real % is far off your self-rated confidence, your self-assessment is wrong - adjust the bar.',
              },
            ],
            doneWhen: {
              vi: 'Confidence khớp tương đối với điểm thật; khoanh sẵn domain sẽ đào sâu ngày 26/09.',
              en: 'Confidence roughly matches the real scores; the domain to deep-dive on 26/09 is already picked out.',
            },
          },
        ],
      },
      {
        id: 'w3-3',
        date: '2026-09-21',
        hours: 3,
        title: {
          vi: 'Ex3b validation-retry',
          en: 'Ex3b validation-retry',
        },
        tasks: [
          {
            id: 'w3-3-0',
            title: {
              vi: 'Ex3b: validation-retry (gửi lại doc + extraction hỏng + lỗi cụ thể) + phân loại lỗi retry được/không + few-shot (2 giờ)',
              en: 'Ex3b: validation-retry (resend doc + broken extraction + the specific error) + classify retryable vs non-retryable errors + few-shot (2 hours)',
            },
            tags: ['d4', 'd5'],
            steps: [
              {
                vi: 'Validate bằng Pydantic/JSON schema. Hỏng → gửi lại <strong>3 thứ</strong>: tài liệu gốc, bản hỏng, lỗi cụ thể.',
                en: 'Validate with Pydantic/JSON schema. On failure, send back <strong>three things</strong>: the original document, the broken output, and the specific error.',
              },
              {
                vi: 'Ghi log: lỗi nào retry qua (định dạng), lỗi nào retry mãi vẫn hỏng (thông tin không có trong nguồn). Thêm <code>calculated_total</code> vs <code>stated_total</code> + <code>conflict_detected</code>.',
                en: 'Log it: which errors the retry fixes (formatting), which ones stay broken no matter how many retries (information absent from the source). Add <code>calculated_total</code> vs <code>stated_total</code> + <code>conflict_detected</code>.',
              },
              {
                vi: 'Thêm 2-4 few-shot cho format đa dạng; đo tỉ lệ đúng trước/sau.',
                en: 'Add 2-4 few-shot examples for varied formats; measure accuracy before and after.',
              },
            ],
            doneWhen: {
              vi: 'Phân biệt được khi nào retry là vô ích.',
              en: 'You can tell when a retry is pointless.',
            },
          },
          {
            id: 'w3-3-1',
            title: {
              vi: 'Đọc task <strong>4.2, 4.4</strong> (20 phút)',
              en: 'Read tasks <strong>4.2, 4.4</strong> (20 minutes)',
            },
            tags: ['d4'],
            steps: [
              {
                vi: 'Few-shot và validation/retry/feedback loop. Đối chiếu, sửa nếu thiếu.',
                en: 'Few-shot and the validation/retry/feedback loop. Cross-check and fix anything missing.',
              },
            ],
            doneWhen: { vi: 'Khớp.', en: 'Matches.' },
          },
        ],
      },
      {
        id: 'w3-4',
        date: '2026-09-22',
        hours: 3.5,
        title: {
          vi: 'Ex3c Batch API',
          en: 'Ex3c Batch API',
        },
        tasks: [
          {
            id: 'w3-4-0',
            title: {
              vi: 'Ex3c: Batch API 100 docs + <code>custom_id</code> + resubmit lỗi + tính SLA; confidence theo trường; stratified sampling (2,5 giờ)',
              en: 'Ex3c: Batch API with 100 docs + <code>custom_id</code> + resubmit failures + compute the SLA; per-field confidence; stratified sampling (2.5 hours)',
            },
            tags: ['d4', 'd5'],
            steps: [
              {
                vi: 'Gửi batch 100 tài liệu, mỗi cái <code>custom_id</code>. Giả lập lỗi, gửi lại đúng cái hỏng, chunk cái quá dài. Tính: batch tới 24h → SLA 30h thì submit bao lâu một lần.',
                en: 'Submit a batch of 100 documents, each with a <code>custom_id</code>. Simulate failures, resend only the broken ones, chunk the overlong ones. Compute: batches take up to 24h → with a 30h SLA, how often do you submit.',
              },
              {
                vi: 'Model xuất confidence <strong>theo trường</strong>; confidence thấp / nguồn mâu thuẫn → human review. Ngưỡng hiệu chỉnh bằng validation set gán nhãn.',
                en: 'Have the model emit confidence <strong>per field</strong>; low confidence / conflicting sources → human review. Calibrate the threshold with a labeled validation set.',
              },
              {
                vi: 'Stratified sampling theo loại tài liệu & trường - accuracy tổng 97% vẫn che được một loại đang sai 40%.',
                en: 'Stratified sampling by document type and field - 97% overall accuracy can still hide one type sitting at 40% wrong.',
              },
            ],
            doneWhen: {
              vi: 'Có bảng accuracy tách theo loại tài liệu; nói được việc nào dùng batch.',
              en: 'You have an accuracy table broken down by document type; you can say which tasks belong in a batch.',
            },
          },
          {
            id: 'w3-4-1',
            title: {
              vi: 'Đọc task <strong>4.5, 5.5</strong> (20 phút)',
              en: 'Read tasks <strong>4.5, 5.5</strong> (20 minutes)',
            },
            tags: ['d4', 'd5'],
            steps: [
              {
                vi: 'Batch strategy và human review / confidence calibration. Đối chiếu.',
                en: 'Batch strategy and human review / confidence calibration. Cross-check.',
              },
            ],
            doneWhen: { vi: 'Khớp.', en: 'Matches.' },
          },
        ],
      },
      {
        id: 'w3-5',
        date: '2026-09-23',
        hours: 2.5,
        title: {
          vi: 'Ex4a multi-agent',
          en: 'Ex4a multi-agent',
        },
        tasks: [
          {
            id: 'w3-5-0',
            title: {
              vi: 'Ex4a: coordinator có <code>"Task"</code> trong allowedTools, ≥2 subagent, spawn song song, structured output có nguồn + ngày (2 giờ)',
              en: 'Ex4a: coordinator with <code>"Task"</code> in allowedTools, ≥2 subagents, parallel spawn, structured output with source + date (2 hours)',
            },
            tags: ['d1', 'd2', 'd5'],
            steps: [
              {
                vi: 'Coordinator thiếu <code>"Task"</code> trong <code>allowedTools</code> là không spawn được. 2 subagent (web search, doc analysis), mỗi cái chỉ có tool của vai trò nó.',
                en: 'A coordinator missing <code>"Task"</code> in <code>allowedTools</code> cannot spawn anything. 2 subagents (web search, doc analysis), each with only the tools its role needs.',
              },
              {
                vi: 'Truyền context <strong>tường minh trong prompt</strong>. Spawn song song = nhiều Task call trong <strong>một</strong> lượt; đo thời gian so tuần tự.',
                en: 'Pass context <strong>explicitly in the prompt</strong>. Parallel spawn = multiple Task calls in <strong>one</strong> turn; measure the time against running them sequentially.',
              },
              {
                vi: 'Mỗi phát hiện: claim + evidence + URL/tên tài liệu + ngày xuất bản. Tách nội dung khỏi metadata.',
                en: 'Every finding: claim + evidence + URL/document name + publication date. Keep content separate from metadata.',
              },
            ],
            doneWhen: {
              vi: 'Hai subagent chạy chồng thời gian; báo cáo truy được nguồn từng ý.',
              en: 'The two subagents overlap in time; every point in the report traces back to a source.',
            },
          },
        ],
      },
      {
        id: 'w3-6',
        date: '2026-09-24',
        hours: 3,
        title: {
          vi: 'Ex4b · CI · hết 29 task statement',
          en: 'Ex4b · CI · all 29 task statements',
        },
        tasks: [
          {
            id: 'w3-6-0',
            title: {
              vi: 'Ex4b: giả lập timeout → error context có cấu trúc + coverage gaps; 2 nguồn mâu thuẫn giữ cả hai; script CI <code>claude -p</code> (2 giờ)',
              en: 'Ex4b: simulate a timeout → structured error context + coverage gaps; keep both when two sources conflict; CI script with <code>claude -p</code> (2 hours)',
            },
            tags: ['d5', 'd1', 'd3'],
            steps: [
              {
                vi: 'Subagent timeout → coordinator nhận: loại lỗi, query đã thử, partial results, hướng thay thế. Báo cáo cuối ghi coverage gaps. 4 cách <strong>sai</strong>: status chung chung, nuốt lỗi, retry im lặng, dừng cả workflow.',
                en: 'Subagent timeout → the coordinator receives: error type, queries already tried, partial results, alternative directions. The final report records coverage gaps. 4 <strong>wrong</strong> ways: a generic status, swallowing the error, retrying silently, halting the whole workflow.',
              },
              {
                vi: '2 nguồn đáng tin lệch số → giữ cả hai kèm nguồn + ngày, tách "well-established" / "contested".',
                en: 'Two trustworthy sources disagreeing on a number → keep both with source + date, and separate "well-established" from "contested".',
              },
              {
                vi: 'Script CI theo lệnh dưới. <code>-p</code> là thứ khiến pipeline không treo. Lần sau đưa findings cũ vào context để chỉ báo issue mới.',
                en: 'CI script per the command below. <code>-p</code> is what keeps the pipeline from hanging. Next run, feed the previous findings into context so it only reports new issues.',
              },
            ],
            doneWhen: {
              vi: 'Coordinator đi tiếp với kết quả một phần; script CI xuất JSON parse được.',
              en: 'The coordinator carries on with partial results; the CI script emits parseable JSON.',
            },
            code: 'claude -p "Review this diff for security issues" \\\n  --output-format json \\\n  --json-schema ./review-schema.json',
          },
          {
            id: 'w3-6-1',
            title: {
              vi: 'Đọc task <strong>1.2, 1.3, 1.6, 1.7, 5.1, 5.3, 5.6, 3.6, 4.6</strong> - đối chiếu Ex4 + CI (30 phút)',
              en: 'Read tasks <strong>1.2, 1.3, 1.6, 1.7, 5.1, 5.3, 5.6, 3.6, 4.6</strong> - cross-check against Ex4 + CI (30 minutes)',
            },
            tags: ['d1', 'd5', 'd3', 'd4'],
            steps: [
              {
                vi: 'Đọc lướt, mỗi dòng hỏi: code có làm không? Đây là lần cuối chạm task statement trước khi vào chuỗi mock.',
                en: 'Skim it, asking of each line: does the code do this? This is the last time you touch the task statements before the mock run.',
              },
            ],
            doneWhen: {
              vi: 'Đã đọc đủ 29 task statement của cả 5 domain, mỗi cái ít nhất một lần kèm code.',
              en: 'You have read all 29 task statements across the 5 domains, each at least once alongside code.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'w4',
    label: { vi: 'Tuần thi', en: 'Exam week' },
    phase: {
      vi: 'Đề 4-5 · quyết định · thi 27/09',
      en: 'Mocks 4-5 · the call · exam 27/09',
    },
    range: '25-30/09',
    span: 6,
    desc: {
      vi: 'Đề 4 tối thứ Sáu 25 và chốt giữ hay dời lịch ngay tối đó - hạn đổi miễn phí là 24 giờ trước giờ thi nên không để sang thứ Bảy. Thứ Bảy 26: tổng duyệt Đề 5 buổi sáng, chiều vá đúng lỗ hổng vừa lộ, không học khái niệm mới. Thi Chủ nhật 27. Ba ngày sau để chốt với L&D và đặt nhắc gia hạn.',
      en: 'Mock 4 on Friday evening the 25th, and the keep-or-reschedule call that same evening - the free-change deadline is 24 hours before the exam slot, so it cannot wait for Saturday. Saturday the 26th: a dress rehearsal on Mock 5 in the morning, then patch exactly the gaps it exposes. No new material. Exam on Sunday the 27th, and the three days after are for wrapping up with L&D and setting a renewal reminder.',
    },
    days: [
      {
        id: 'w4-0',
        date: '2026-09-25',
        hours: 3,
        title: {
          vi: 'Đề 4 · quyết định giữ hay dời',
          en: 'Mock 4 · keep or reschedule',
        },
        tasks: [
          {
            id: 'w4-0-0',
            title: {
              vi: 'Mock <strong>Đề 4</strong> timed 120 phút (2 giờ)',
              en: 'Mock <strong>4</strong>, timed 120 minutes (2 hours)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Không F5. Ghi nhật ký. Mục tiêu: <strong>≥80%</strong>, không domain <70%.',
                en: 'No refresh. Log it. Target: <strong>≥80%</strong>, no domain <70%.',
              },
              {
                vi: 'Đây là <strong>đề quyết định</strong> - điểm của nó cùng với Đề 3 là căn cứ để giữ hay dời lịch ngay tối nay. Làm sớm, đừng bắt đầu sau 20h.',
                en: 'This is <strong>the deciding mock</strong> - its score together with Mock 3 is what the keep-or-reschedule call rests on tonight. Start early; do not begin after 8pm.',
              },
              {
                vi: 'Đây là đề làm sau một ngày đi làm, nên trừ hao: thấp hơn Đề 3 vài điểm là do mệt chứ chưa chắc là tụt.',
                en: 'You are taking this after a full work day, so allow for it: a few points below Mock 3 is fatigue, not necessarily a regression.',
              },
            ],
            doneWhen: {
              vi: 'Dòng thứ 4 trong nhật ký.',
              en: 'Fourth line in the log.',
            },
          },
          {
            id: 'w4-0-1',
            title: {
              vi: 'Review Đề 4 (30 phút)',
              en: 'Review Mock 4 (30 minutes)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Ghi quy tắc vi phạm. Khoanh đúng 1 domain yếu nhất để vá chiều mai, ngay sau Đề 5.',
                en: 'Note the rules you broke. Pick exactly 1 weakest domain to patch tomorrow afternoon, right after Mock 5.',
              },
            ],
            doneWhen: {
              vi: 'Biết chính xác còn hổng chỗ nào.',
              en: 'You know exactly where the gaps still are.',
            },
          },
          {
            id: 'w4-0-2',
            title: {
              vi: '<strong>Quyết định tối nay:</strong> Đề 3 & 4 đều ≥80% và không domain <70% → giữ 27/09. Không đạt → dời lịch ngay (miễn phí trước 24h)',
              en: '<strong>Decide tonight:</strong> Mocks 3 and 4 both ≥80% and no domain <70% → keep 27/09. Anything less → reschedule right away (free more than 24h out)',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Quyết tối nay chứ không đợi Đề 5 sáng mai: hạn đổi miễn phí là <strong>24 giờ trước giờ thi</strong>, mà giờ thi có thể là sáng Chủ nhật - lúc đó hạn đã trôi qua từ sáng thứ Bảy.',
                en: 'Decide tonight rather than waiting for Mock 5 tomorrow morning: the free-change window closes <strong>24 hours before the exam slot</strong>, and if that slot is Sunday morning the window is already gone by Saturday morning.',
              },
              {
                vi: 'Đạt → nghỉ. Không đạt → vào Pearson VUE dời sang tuần sau (vẫn trước 01/10), báo L&D một câu.',
                en: 'Threshold met → rest. Not met → go into Pearson VUE and move it to next week (still before 01/10), then send L&D a one-liner.',
              },
              {
                vi: 'Nhớ: rớt là tự trả $125 và chờ 14 ngày - dời 3-4 ngày rẻ hơn nhiều so với thi liều.',
                en: 'Remember: a fail is $125 out of your own pocket plus a 14-day wait - pushing 3-4 days is far cheaper than sitting the exam unprepared.',
              },
            ],
            doneWhen: {
              vi: 'Đã quyết, và lịch Pearson VUE phản ánh đúng quyết định đó.',
              en: 'Decision made, and the Pearson VUE booking matches it.',
            },
          },
        ],
      },
      {
        id: 'w4-1',
        date: '2026-09-26',
        hours: 6.5,
        title: {
          vi: 'Tổng duyệt Đề 5 · vá lỗ hổng · hạ nhiệt',
          en: 'Dress rehearsal Mock 5 · patch gaps · wind down',
        },
        tasks: [
          {
            id: 'w4-1-0',
            title: {
              vi: 'Mock <strong>Đề 5</strong> buổi sáng - tổng duyệt đúng khung giờ thi, 120 phút + review (2,5 giờ)',
              en: '<strong>Mock 5</strong> in the morning - a dress rehearsal at the same hour as the exam, 120 minutes + review (2.5 hours)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Bắt đầu <strong>đúng giờ ghi trên lịch Pearson VUE</strong> của ngày mai. Mục đích là để cơ thể quen với việc tập trung 2 tiếng vào khung giờ đó, không phải để lấy điểm.',
                en: "Start <strong>at the exact time on tomorrow's Pearson VUE booking</strong>. The point is to get used to concentrating for two hours in that slot, not to produce a score.",
              },
              {
                vi: 'Đề cuối. Không F5. Ghi nhật ký, review 30 phút tập trung vào câu sai lặp lại.',
                en: 'Last practice test. No refreshing. Write it up in the log, then review for 30 minutes focused on the mistakes that keep repeating.',
              },
              {
                vi: 'Quyết định giữ hay dời <strong>đã chốt tối qua</strong>. Đề này thấp hơn kỳ vọng cũng không lật lại quyết định đó - dùng nó để biết chiều nay vá gì, hết.',
                en: 'The keep-or-reschedule call was <strong>settled last night</strong>. A lower-than-hoped score here does not reopen it - use it to decide what to patch this afternoon, nothing more.',
              },
            ],
            doneWhen: {
              vi: 'Dòng thứ 5 trong nhật ký.',
              en: 'Fifth row in the log.',
            },
          },
          {
            id: 'w4-1-1',
            title: {
              vi: 'Đào sâu domain thấp nhất theo Đề 3-5: đọc lại note + task statement + sửa code lab (1,5 giờ)',
              en: 'Deep-dive the weakest domain from Mocks 3-5: re-read the notes + task statement + fix the lab code (1.5 hours)',
            },
            tags: ['d1', 'd2', 'd5'],
            steps: [
              {
                vi: 'Lấy domain % thấp nhất qua 3 đề gần nhất. Đọc lại note tiếng Việt + đúng task statement của domain đó. <strong>Chỉ một domain</strong> - hôm nay không đủ thời gian cho hai.',
                en: "Take the domain with the lowest % across the last 3 mocks. Re-read the Vietnamese notes + that domain's actual task statements. <strong>One domain only</strong> - there is no time for two today.",
              },
              {
                vi: 'Nếu là D1 hay D2 (khả năng cao theo Đề 1): mở lại Ex1 và Ex4, làm lại đúng phần yếu.',
                en: 'If it is D1 or D2 (likely, based on Mock 1): reopen Ex1 and Ex4 and redo exactly the weak part.',
              },
              {
                vi: 'Nếu là D5: đọc lại 5.1-5.6 và chạy lại phần error propagation / provenance của Ex4b.',
                en: 'If it is D5: re-read 5.1-5.6 and rerun the error propagation / provenance part of Ex4b.',
              },
            ],
            doneWhen: {
              vi: 'Trả lời lại được mọi câu sai của domain đó mà không nhìn đáp án.',
              en: 'You can re-answer every question you got wrong in that domain without looking at the answers.',
            },
          },
          {
            id: 'w4-1-2',
            title: {
              vi: 'Học <strong>Bảng chốt 6 nhóm</strong> lần 1 - che, viết lại ra giấy (30 phút)',
              en: 'Study the <strong>6-group cheat sheet</strong>, pass 1 - cover it, write it out on paper (30 minutes)',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Mở thẻ <em>Bảng chốt</em> cuối trang. Che, viết 6 nhóm, mở ra so.',
                en: 'Open the <em>Cheat sheet</em> card at the bottom of the page. Cover it, write out the 6 groups, then uncover and compare.',
              },
              {
                vi: 'Nhóm nào thiếu → đánh dấu, tối nay và sáng 27/09 ôn lại đúng nhóm đó.',
                en: 'Any group you miss → mark it, and review exactly that group tonight and on the morning of 27/09.',
              },
            ],
            doneWhen: {
              vi: 'Viết lại được ≥5/6 nhóm không nhìn.',
              en: 'You can write out ≥5/6 groups without looking.',
            },
          },
          {
            id: 'w4-1-3',
            title: {
              vi: 'Luyện loại bẫy đáp án: gom câu sai Đề 2-5, gọi tên loại bẫy từng phương án (30 phút)',
              en: 'Drill trap types: collect the wrong answers from Mocks 2-5, name the trap type in each option (30 minutes)',
            },
            tags: ['m'],
            steps: [
              {
                vi: 'Tính năng bịa (<code>--batch</code>, <code>CLAUDE_HEADLESS</code>, <code>.claude/config.json</code>…), prompt thay hook, self-review, batch cho việc blocking, confidence tự báo. Đối chiếu thẻ <em>Bẫy đáp án</em>.',
                en: 'Invented features (<code>--batch</code>, <code>CLAUDE_HEADLESS</code>, <code>.claude/config.json</code>…), a prompt in place of a hook, self-review, batch for blocking work, self-reported confidence. Cross-check against the <em>Answer traps</em> card.',
              },
            ],
            doneWhen: {
              vi: 'Nhìn phương án lạ là phản xạ "không có trong docs".',
              en: 'An unfamiliar option triggers the reflex "that is not in the docs".',
            },
          },
          {
            id: 'w4-1-4',
            title: {
              vi: 'Đọc lại Bảng chốt + 12 nguyên tắc + Ngoài phạm vi (1 giờ). <strong>Không học gì mới.</strong>',
              en: 'Re-read the cheat sheet + the 12 principles + Out of scope (1 hour). <strong>No new material.</strong>',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Ôn đúng nhóm vừa đánh dấu thiếu ở Bảng chốt lúc chiều. Còn lại chỉ đọc trôi, rồi đi ngủ sớm.',
                en: 'Review exactly the groups you marked as weak on the cheat sheet this afternoon. Skim the rest, then get to bed early.',
              },
            ],
            doneWhen: {
              vi: 'Đọc trôi cả 3 thẻ.',
              en: 'All 3 cards read through smoothly.',
            },
          },
          {
            id: 'w4-1-5',
            title: {
              vi: 'Chuẩn bị chỗ thi: dọn bàn, cất điện thoại/đồng hồ, test webcam + mạng (online) hoặc đường đi + giấy tờ (test center). Ngủ đủ.',
              en: 'Prepare the exam space: clear the desk, put the phone/watch away, test webcam + network (online) or the route + ID documents (test center). Get enough sleep.',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Online: tháo màn hình phụ, chạy thử phần mềm proctor của Pearson VUE.',
                en: 'Online: unplug the second monitor, do a trial run of the Pearson VUE proctor software.',
              },
              {
                vi: 'Test center: tính giờ kẹt xe, giấy tờ còn hạn, tên khớp.',
                en: 'Test center: budget time for traffic, ID documents still valid, name matches.',
              },
            ],
            doneWhen: {
              vi: 'Không còn việc hậu cần nào cho ngày mai.',
              en: 'No logistics left for tomorrow.',
            },
          },
        ],
      },
      {
        id: 'w4-2',
        date: null,
        floating: 'exam',
        hours: 2,
        title: {
          vi: 'Ngày thi',
          en: 'Exam day',
        },
        tasks: [
          {
            id: 'w4-2-0',
            title: {
              vi: 'Đọc Bảng chốt 5 phút trước khi vào phòng',
              en: 'Read the cheat sheet 5 minutes before going in',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Đọc lướt 6 nhóm trên điện thoại rồi cất - vào phòng không mang theo.',
                en: 'Skim the 6 groups on your phone, then put it away - nothing comes into the room with you.',
              },
            ],
            doneWhen: {
              vi: 'Sáu nhóm còn tươi trong đầu.',
              en: 'The six groups are fresh in your head.',
            },
          },
          {
            id: 'w4-2-1',
            title: {
              vi: 'Làm hết checklist "Ngày thi" bên dưới',
              en: 'Work through the "Exam day" checklist below',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Mở thẻ <em>Ngày thi · checklist</em>, tick từng dòng.',
                en: 'Open the <em>Exam day · checklist</em> card and tick every line.',
              },
              {
                vi: 'Ba điều lúc làm bài: đọc kịch bản <strong>một lần</strong> rồi giữ trong đầu; câu multi-response xem đề đòi chọn mấy; câu mơ hồ flag rồi quay lại cuối khối.',
                en: 'Three things while you work: read the scenario <strong>once</strong> and hold it in your head; on multi-response questions check how many answers it asks for; flag anything ambiguous and come back at the end of the block.',
              },
            ],
            doneWhen: {
              vi: 'Nộp bài khi còn dư thời gian soát câu đã flag.',
              en: 'Submitted with time left over to check the flagged questions.',
            },
          },
          {
            id: 'w4-2-2',
            title: {
              vi: 'Sau thi: điểm hiện ngay; đậu → claim badge Credly qua email; ghi điểm thật vào nhật ký',
              en: 'After the exam: the score shows immediately; pass → claim the Credly badge via email; record the real score in the log',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Kiểm hộp thư (cả spam) tìm mail Credly, claim badge.',
                en: 'Check your inbox (spam too) for the Credly email and claim the badge.',
              },
              {
                vi: 'Báo cáo theo domain về trong ~2 ngày làm việc.',
                en: 'The per-domain report arrives in ~2 business days.',
              },
            ],
            doneWhen: {
              vi: 'Badge đã claim, điểm đã ghi.',
              en: 'Badge claimed, score logged.',
            },
          },
          {
            id: 'w4-2-3',
            title: {
              vi: 'Gửi kết quả + hoá đơn $125 cho L&D để refund',
              en: 'Send the result + the $125 receipt to L&D for the refund',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Chụp màn hình kết quả, tải hoá đơn Pearson VUE, gửi theo mẫu công ty.',
                en: 'Screenshot the result, download the Pearson VUE receipt, submit it on the company template.',
              },
              {
                vi: 'Rớt → không gửi refund; nhắn L&D báo tình hình và lịch thi lại (chờ 14 ngày).',
                en: "Fail → don't file for the refund; message L&D with the situation and the retake date (14-day wait).",
              },
            ],
            doneWhen: {
              vi: 'Hồ sơ refund đã nộp.',
              en: 'Refund request submitted.',
            },
          },
        ],
      },
      {
        id: 'w4-3',
        date: '2026-09-28',
        hours: 0.5,
        title: {
          vi: 'Chốt với L&D',
          en: 'Wrap up with L&D',
        },
        tasks: [
          {
            id: 'w4-3-0',
            title: {
              vi: 'Cập nhật sheet "Danh sách thi": đã đậu / lịch thi lại',
              en: 'Update the "Exam list" sheet: passed / retake booked',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Đây là dữ liệu công ty dùng cho mốc Partnership 01/10 - điền sớm.',
                en: 'This is the data the company uses for the 01/10 Partnership milestone - fill it in early.',
              },
            ],
            doneWhen: { vi: 'Sheet đã cập nhật.', en: 'Sheet updated.' },
          },
        ],
      },
      {
        id: 'w4-4',
        date: '2026-09-30',
        hours: 0.5,
        title: {
          vi: 'Đặt nhắc gia hạn',
          en: 'Set a renewal reminder',
        },
        tasks: [
          {
            id: 'w4-4-0',
            title: {
              vi: 'Đặt lịch nhắc gia hạn miễn phí trước khi cert hết hạn (12 tháng)',
              en: 'Set a reminder to renew for free before the certification expires (12 months)',
            },
            tags: ['a'],
            steps: [
              {
                vi: 'Gia hạn đúng hạn = bài đánh giá không giám thị, <strong>miễn phí</strong>. Để hết hạn = thi lại full $125.',
                en: 'Renewing on time = an unproctored assessment, <strong>free</strong>. Letting it expire = a full $125 retake.',
              },
              {
                vi: 'Nhắc trước ngày hết hạn ~1 tháng.',
                en: 'Set the reminder ~1 month before the expiry date.',
              },
            ],
            doneWhen: {
              vi: 'Có lịch nhắc trong calendar.',
              en: 'Reminder is in the calendar.',
            },
          },
        ],
      },
    ],
  },
]
