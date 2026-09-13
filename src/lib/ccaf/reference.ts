import type { Localized } from '@/lib/ccaf/copy'

/**
 * The cram sheet that sits under the plan: facts, judgement rules, and traps.
 *
 * Separate from `roadmap.ts` because it has a different lifetime. The roadmap is a
 * schedule and stops mattering the day the exam is sat; this is the material itself, and
 * the last ten minutes before the exam are spent re-reading the fact groups below.
 *
 * Strings carry the same inline vocabulary as the roadmap steps - `<strong>`, `<em>`,
 * `<code>` - and are rendered by `components/ccaf/RichText`. See the note there for why
 * they are parsed rather than injected. Code spans are identical in both languages: an
 * identifier does not translate.
 */

/** One of the six groups worth re-reading immediately before the exam. */
export type FactGroup = {
  title: Localized
  items: Localized[]
}

/**
 * The six fact clusters, in the order they are memorised.
 *
 * Chosen for a specific property: each one is a fact the exam tests by *recall*, where
 * getting the detail wrong costs a whole question no matter how sound the reasoning
 * around it was. Judgement is trainable in a week; `stop_reason`'s three values are not
 * worth re-deriving under time pressure.
 */
export const FACT_GROUPS: FactGroup[] = [
  {
    title: {
      vi: '1 · stop_reason điều khiển vòng lặp',
      en: '1 · stop_reason drives the loop',
    },
    items: [
      {
        vi: '<code>tool_use</code> → chạy tool, nối kết quả vào lịch sử, gọi tiếp',
        en: '<code>tool_use</code> → run the tool, append the result to the history, call again',
      },
      {
        vi: '<code>end_turn</code> → dừng, trả lời',
        en: '<code>end_turn</code> → stop and answer',
      },
      {
        vi: '<code>max_tokens</code> → bị cắt, không phải "xong"',
        en: '<code>max_tokens</code> → truncated, not finished',
      },
      {
        vi: 'Anti-pattern: parse text để biết dừng, đặt cap vòng lặp làm cơ chế chính, coi có text là xong',
        en: 'Anti-patterns: parsing prose to decide when to stop, using an iteration cap as the primary stop, treating any text as completion',
      },
    ],
  },
  {
    title: { vi: '2 · Lỗi tool có cấu trúc', en: '2 · Structured tool errors' },
    items: [
      {
        vi: 'MCP: cờ <code>isError</code>',
        en: 'MCP: the <code>isError</code> flag',
      },
      {
        vi: '<code>errorCategory</code>: transient / validation / business / permission',
        en: '<code>errorCategory</code>: transient / validation / business / permission',
      },
      {
        vi: '<code>isRetryable</code> boolean; business → <code>retriable:false</code> + giải thích cho khách',
        en: '<code>isRetryable</code> boolean; business errors get <code>retriable:false</code> plus an explanation the customer can read',
      },
      {
        vi: 'Kết quả rỗng hợp lệ ≠ lỗi truy cập',
        en: 'A valid empty result is not an access failure',
      },
      {
        vi: 'Subagent tự phục hồi lỗi tạm; chỉ đẩy lên coordinator lỗi không giải quyết được + partial results + đã thử gì',
        en: 'Subagents recover from transient failures themselves; only what they cannot resolve goes up to the coordinator, with partial results and what was attempted',
      },
    ],
  },
  {
    title: { vi: '3 · tool_choice', en: '3 · tool_choice' },
    items: [
      {
        vi: '<code>auto</code> — model có thể trả text thay vì gọi tool',
        en: '<code>auto</code> — the model may answer in prose instead of calling a tool',
      },
      {
        vi: '<code>any</code> — bắt buộc gọi một tool nào đó',
        en: '<code>any</code> — it must call some tool, but picks which',
      },
      {
        vi: '<code>{"type":"tool","name":"…"}</code> — ép đúng tool này (ví dụ ép <code>extract_metadata</code> trước bước enrichment)',
        en: '<code>{"type":"tool","name":"…"}</code> — forces one named tool (e.g. running <code>extract_metadata</code> before any enrichment step)',
      },
    ],
  },
  {
    title: { vi: '4 · Thiết kế schema', en: '4 · Schema design' },
    items: [
      {
        vi: 'required vs optional; <strong>nullable</strong> khi nguồn có thể thiếu → tránh bịa',
        en: 'Required vs optional; make a field <strong>nullable</strong> when the source may not carry it, or the model invents one',
      },
      {
        vi: 'enum + <code>"other"</code> + trường detail; <code>"unclear"</code> cho ca mơ hồ',
        en: 'Enums get an <code>"other"</code> member plus a detail field, and <code>"unclear"</code> for genuinely ambiguous cases',
      },
      {
        vi: 'Schema chặt loại lỗi <em>cú pháp</em>, không loại lỗi <em>ngữ nghĩa</em> (tổng không khớp, sai ô) → cần validation + retry',
        en: 'A strict schema eliminates <em>syntax</em> errors, never <em>semantic</em> ones (totals that do not add up, values in the wrong field) — those need validation and a retry',
      },
      {
        vi: 'Retry vô ích khi thông tin không có trong nguồn',
        en: 'Retrying is pointless when the information simply is not in the source',
      },
    ],
  },
  {
    title: {
      vi: '5 · Hiệu chỉnh độ tin cậy',
      en: '5 · Confidence calibration',
    },
    items: [
      {
        vi: 'Confidence <strong>theo từng trường</strong>, hiệu chỉnh bằng validation set gán nhãn',
        en: 'Confidence <strong>per field</strong>, calibrated against a labelled validation set',
      },
      {
        vi: 'Stratified random sampling theo loại tài liệu / trường',
        en: 'Stratified random sampling by document type and by field',
      },
      {
        vi: 'Accuracy tổng 97% có thể che segment yếu',
        en: '97% overall accuracy can hide one segment performing far worse',
      },
      {
        vi: 'Confidence tự báo & sentiment <strong>không</strong> phải proxy cho độ phức tạp ca',
        en: 'Self-reported confidence and sentiment are <strong>not</strong> proxies for how hard a case is',
      },
    ],
  },
  {
    title: { vi: '6 · Cờ, file, lệnh', en: '6 · Flags, files, commands' },
    items: [
      {
        vi: 'CI: <code>claude -p</code> / <code>--print</code>, <code>--output-format json</code>, <code>--json-schema</code>',
        en: 'CI: <code>claude -p</code> / <code>--print</code>, <code>--output-format json</code>, <code>--json-schema</code>',
      },
      {
        vi: 'Phiên: <code>--resume &lt;name&gt;</code>, <code>fork_session</code>, <code>/compact</code>, <code>/memory</code>',
        en: 'Sessions: <code>--resume &lt;name&gt;</code>, <code>fork_session</code>, <code>/compact</code>, <code>/memory</code>',
      },
      {
        vi: '<code>.mcp.json</code> (project, <code>${VAR}</code>) vs <code>~/.claude.json</code> (cá nhân)',
        en: '<code>.mcp.json</code> (project scope, <code>${VAR}</code> expansion) vs <code>~/.claude.json</code> (personal)',
      },
      {
        vi: '<code>.claude/commands/</code> · <code>.claude/skills/SKILL.md</code> (<code>context: fork</code>, <code>allowed-tools</code>, <code>argument-hint</code>) · <code>.claude/rules/</code> (<code>paths:</code> glob) · <code>@import</code>',
        en: '<code>.claude/commands/</code> · <code>.claude/skills/SKILL.md</code> (<code>context: fork</code>, <code>allowed-tools</code>, <code>argument-hint</code>) · <code>.claude/rules/</code> (<code>paths:</code> globs) · <code>@import</code>',
      },
      {
        vi: 'Batches API: −50% chi phí, tới 24h, <code>custom_id</code>, không tool multi-turn',
        en: 'Batches API: 50% cheaper, up to 24h, <code>custom_id</code> for correlation, no multi-turn tool calling',
      },
    ],
  },
]

/**
 * Twelve decision rules distilled from the rationales in the official Exam Guide.
 *
 * These are the difference between a pass and a good score. The exam plants options that
 * are individually reasonable, so the work is ranking them - and the rationales show the
 * ranking is consistent enough to be written down.
 */
export const JUDGMENT_RULES: Localized[] = [
  {
    vi: '<strong>Cần tuân thủ chắc chắn</strong> (tiền, danh tính) → hook / prerequisite lập trình. Prompt luôn có tỉ lệ hỏng khác 0.',
    en: '<strong>When compliance must be guaranteed</strong> (money, identity) → a hook or a programmatic prerequisite. A prompt always has a non-zero failure rate.',
  },
  {
    vi: '<strong>Chọn sai tool</strong> → sửa <em>description</em> trước (input, ví dụ, ranh giới, khi nào dùng), rồi mới tới few-shot hay routing.',
    en: '<strong>Wrong tool picked</strong> → fix the <em>description</em> first (inputs, examples, boundaries, when to use it over a sibling), and only then reach for few-shot or a router.',
  },
  {
    vi: '<strong>Lỗi phải có ngữ cảnh</strong>: loại lỗi, retry được không, đã thử gì, kết quả một phần. Không "Operation failed", không nuốt lỗi, không dừng cả workflow.',
    en: '<strong>Errors carry context</strong>: category, whether a retry can help, what was attempted, any partial result. Never "Operation failed", never swallowed, never take down the whole workflow.',
  },
  {
    vi: '<strong>Tool theo vai trò, tối thiểu</strong> (4–5, không 18). Cross-role chỉ cấp scoped tool cho nhu cầu tần suất cao; ca phức tạp vẫn qua coordinator.',
    en: '<strong>Tools scoped to a role, and few</strong> (4–5, not 18). Grant a cross-role tool only for a high-frequency need; complex cases still route through the coordinator.',
  },
  {
    vi: '<strong>Subagent không kế thừa context</strong> — truyền tường minh trong prompt; spawn song song bằng nhiều Task trong <em>một</em> lượt; coordinator phải có "Task" trong allowedTools.',
    en: '<strong>Subagents inherit nothing</strong> — pass context explicitly in the prompt; spawn in parallel by emitting several Task calls in <em>one</em> turn; the coordinator needs "Task" in allowedTools.',
  },
  {
    vi: '<strong>Bao phủ thiếu</strong> → soi cách coordinator phân rã trước khi đổ lỗi subagent.',
    en: '<strong>Incomplete coverage</strong> → inspect how the coordinator decomposed the work before blaming a subagent.',
  },
  {
    vi: '<strong>Escalation</strong> theo tiêu chí tường minh + few-shot. Khách đòi người thật → chuyển ngay. Chính sách im lặng → escalate. Không dùng sentiment / confidence tự báo.',
    en: '<strong>Escalation</strong> runs on explicit criteria plus few-shot examples. A customer asking for a human gets one immediately. Policy silent on the case → escalate. Never trigger on sentiment or self-reported confidence.',
  },
  {
    vi: '<strong>Structured output</strong> = tool_use + JSON schema; nullable cho dữ liệu có thể thiếu; enum có "other"+detail.',
    en: '<strong>Structured output</strong> means tool_use with a JSON schema; nullable for anything the source may omit; enums carry "other" plus a detail field.',
  },
  {
    vi: '<strong>Retry</strong> chỉ chữa lỗi định dạng / cấu trúc; kèm tài liệu gốc + extraction hỏng + lỗi cụ thể.',
    en: '<strong>Retries</strong> only fix format and structure problems, and must resend the original document, the failed extraction, and the specific validation error.',
  },
  {
    vi: '<strong>Batch API</strong> chỉ cho việc chịu trễ (báo cáo đêm, audit tuần). Pre-merge check → API đồng bộ.',
    en: '<strong>The Batch API</strong> is for latency-tolerant work only (overnight reports, weekly audits). A blocking pre-merge check needs the synchronous API.',
  },
  {
    vi: '<strong>Review</strong>: instance độc lập > tự review; nhiều file → pass từng file + pass tích hợp; context lớn hơn không chữa attention dilution.',
    en: '<strong>Review</strong>: an independent instance beats self-review; many files need a per-file pass plus an integration pass; a bigger context window does not cure attention dilution.',
  },
  {
    vi: '<strong>Claude Code</strong>: plan mode cho việc kiến trúc / nhiều file; <code>.claude/commands</code> để chia sẻ team; <code>.claude/rules</code> glob cho convention xuyên thư mục; <code>context: fork</code> cho skill ồn ào.',
    en: '<strong>Claude Code</strong>: plan mode for architectural or multi-file work; <code>.claude/commands</code> to share with the team; <code>.claude/rules</code> globs for conventions that cut across directories; <code>context: fork</code> for a noisy skill.',
  },
]

/** A plausible-sounding distractor and the reason it cannot be right. */
export type AnswerTrap = {
  /**
   * The thing the option names. Localized because the list mixes two kinds of entry: real
   * invented identifiers, which are byte-identical in both languages because an identifier
   * does not translate, and two descriptive phrases ("a larger model") that do.
   */
  token: Localized
  why: Localized
}

/**
 * Distractors that name something which does not exist.
 *
 * The single highest-yield elimination heuristic on this exam: an option describing a
 * flag, file or field absent from the official docs is wrong regardless of how sensible
 * the surrounding sentence reads.
 */
export const ANSWER_TRAPS: AnswerTrap[] = [
  {
    token: { vi: '--batch', en: '--batch' },
    why: {
      vi: 'Không có cờ này. Chạy CI dùng <code>-p</code>.',
      en: 'No such flag. CI runs use <code>-p</code>.',
    },
  },
  {
    token: { vi: 'CLAUDE_HEADLESS=true', en: 'CLAUDE_HEADLESS=true' },
    why: {
      vi: 'Biến môi trường bịa.',
      en: 'An invented environment variable.',
    },
  },
  {
    token: { vi: '.claude/config.json', en: '.claude/config.json' },
    why: {
      vi: 'Không có "commands array" ở đây; slash command nằm trong <code>.claude/commands/</code>.',
      en: 'There is no "commands array" here; slash commands live in <code>.claude/commands/</code>.',
    },
  },
  {
    token: { vi: 'inherit_history', en: 'inherit_history' },
    why: {
      vi: 'Subagent không tự kế thừa lịch sử coordinator — phải truyền trong prompt.',
      en: 'A subagent never inherits the coordinator’s history — it has to be passed in the prompt.',
    },
  },
  {
    token: { vi: 'confidence 1–10', en: 'confidence 1–10' },
    why: {
      vi: 'Tự báo confidence để route escalation: kém hiệu chỉnh, guide bác thẳng.',
      en: 'Routing escalation on self-reported confidence is poorly calibrated, and the guide rejects it outright.',
    },
  },
  {
    token: { vi: 'model to hơn', en: 'a larger model' },
    why: {
      vi: 'Context window lớn hơn không giải quyết review 14 file thiếu nhất quán — chia pass.',
      en: 'A bigger context window does not fix an inconsistent 14-file review — split it into passes.',
    },
  },
  {
    token: { vi: 'vote 2/3 lần', en: 'best of 3 runs' },
    why: {
      vi: 'Chạy 3 lần lấy đồng thuận sẽ ẩn bug chỉ bắt được ngẫu nhiên.',
      en: 'Taking the consensus of three runs hides the bug that only one run happens to catch.',
    },
  },
]

/** Topics the Exam Guide names as explicitly untested - listed so they stay unstudied. */
export const OUT_OF_SCOPE: Localized[] = [
  {
    vi: 'Fine-tuning, RLHF, Constitutional AI, kiến trúc nội bộ model',
    en: 'Fine-tuning, RLHF, Constitutional AI, the model’s internal architecture',
  },
  {
    vi: 'Billing, auth/OAuth, key rotation, rate limit, tính giá token',
    en: 'Billing, auth/OAuth, key rotation, rate limits, token pricing',
  },
  {
    vi: 'Computer use, vision, streaming/SSE, embeddings/vector DB',
    en: 'Computer use, vision, streaming/SSE, embeddings and vector databases',
  },
  {
    vi: 'Hosting MCP server (hạ tầng, container), config AWS/GCP/Azure',
    en: 'Hosting an MCP server (infrastructure, containers), AWS/GCP/Azure configuration',
  },
  {
    vi: 'Prompt caching chi tiết (chỉ cần biết nó tồn tại), tokenization',
    en: 'Prompt caching internals (knowing it exists is enough), tokenization',
  },
]

/** One exam-day item. Ids are persisted, so they are fixed - see `models/CcafProgress`. */
export type ExamDayCheck = {
  id: string
  text: Localized
}

/**
 * The exam-day checklist.
 *
 * `ck1`..`ck8` are the ids the previous tracker wrote, kept verbatim so an imported
 * snapshot lands on the right rows. Half of these are logistics rather than knowledge,
 * and that is deliberate: a name mismatch against photo ID ends the attempt at the door,
 * which costs the same as failing but teaches nothing.
 */
export const EXAM_DAY_CHECKS: ExamDayCheck[] = [
  {
    id: 'ck1',
    text: {
      vi: 'Tên trên tài khoản Pearson VUE khớp <strong>từng ký tự</strong> với CMND/CCCD/hộ chiếu (sai → email <code>certifications-support@anthropic.com</code> trước khi đặt lịch)',
      en: 'The name on the Pearson VUE account matches the photo ID <strong>character for character</strong> (if not, email <code>certifications-support@anthropic.com</code> before booking)',
    },
  },
  {
    id: 'ck2',
    text: {
      vi: 'Đã đặt lịch; nhớ đổi/hủy phải <strong>trước 24 giờ</strong>, trễ là mất trọn $125',
      en: 'Exam booked; rescheduling or cancelling must happen <strong>more than 24h ahead</strong> or the full $125 is forfeited',
    },
  },
  {
    id: 'ck3',
    text: {
      vi: 'Thi online: bàn trống, không điện thoại / smartwatch / tai nghe / màn hình thứ 2, webcam nhìn thấy suốt buổi',
      en: 'Testing online: clear desk, no phone, smartwatch, headphones or second monitor, webcam on for the whole session',
    },
  },
  {
    id: 'ck4',
    text: {
      vi: 'Chấp nhận NDA đầu giờ (không chấp nhận = kết thúc, không hoàn tiền)',
      en: 'Accept the NDA at the start (declining ends the session with no refund)',
    },
  },
  {
    id: 'ck5',
    text: {
      vi: 'Nhịp: 4 block × 15 câu ≈ <strong>30 phút/block</strong>; đọc kịch bản <em>một lần</em> rồi giữ trong đầu',
      en: 'Pacing: 4 blocks × 15 questions ≈ <strong>30 minutes per block</strong>; read each scenario <em>once</em> and hold it in your head',
    },
  },
  {
    id: 'ck6',
    text: {
      vi: 'Câu multi-response: đọc kỹ đề yêu cầu chọn <strong>mấy</strong> đáp án',
      en: 'On multi-response questions, check <strong>how many</strong> answers the prompt asks for',
    },
  },
  {
    id: 'ck7',
    text: {
      vi: 'Câu mơ hồ → flag, đi tiếp, quay lại cuối block',
      en: 'Ambiguous question → flag it, move on, come back at the end of the block',
    },
  },
  {
    id: 'ck8',
    text: {
      vi: 'Sau thi: điểm pass/fail hiện ngay → claim badge Credly qua email → gửi kết quả + hóa đơn cho L&D để refund → báo cáo theo domain ~2 ngày làm việc',
      en: 'Afterwards: pass/fail shows immediately → claim the Credly badge from the email → send the result and receipt to L&D for reimbursement → per-domain report arrives in ~2 working days',
    },
  },
]

/** A link worth reaching in one click on exam week. */
export type Resource = {
  href: string
  label: Localized
  /** Short tag: a percentage, a source name, or a word that needs translating. */
  note: Localized
}

export const RESOURCES: Resource[] = [
  {
    href: 'https://everpath-course-content.s3-accelerate.amazonaws.com/instructor/6nizmqk8tpzpfjvt6qmmav7rh/public/1783542750/Claude+Certified+Architect+%E2%80%93+Foundations+Exam+Guide.pdf',
    label: {
      vi: 'Exam Guide chính thức (PDF, 39 trang)',
      en: 'The official Exam Guide (PDF, 39 pages)',
    },
    note: { vi: 'Anthropic', en: 'Anthropic' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/claude-certified-architect-foundations',
    label: {
      vi: 'Trang CCA-F + tab "Đề thi thử" (600 câu)',
      en: 'CCA-F page plus the practice-test tab (600 questions)',
    },
    note: { vi: 'nguyenchau.dev', en: 'nguyenchau.dev' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/cca-f-domain-1',
    label: {
      vi: 'Domain 1 · Agentic Architecture',
      en: 'Domain 1 · Agentic Architecture',
    },
    note: { vi: '27%', en: '27%' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/cca-f-domain-2',
    label: {
      vi: 'Domain 2 · Tool Design & MCP',
      en: 'Domain 2 · Tool Design & MCP',
    },
    note: { vi: '18%', en: '18%' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/cca-f-domain-3',
    label: {
      vi: 'Domain 3 · Claude Code Config',
      en: 'Domain 3 · Claude Code Config',
    },
    note: { vi: '20%', en: '20%' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/cca-f-domain-4',
    label: {
      vi: 'Domain 4 · Prompt & Structured Output',
      en: 'Domain 4 · Prompt & Structured Output',
    },
    note: { vi: '20%', en: '20%' },
  },
  {
    href: 'https://nguyenchau.dev/learn/claude/cca-f-domain-5',
    label: {
      vi: 'Domain 5 · Context & Reliability',
      en: 'Domain 5 · Context & Reliability',
    },
    note: { vi: '15%', en: '15%' },
  },
  {
    href: 'https://anthropic.skilljar.com',
    label: {
      vi: 'Anthropic Academy (Course Certificates miễn phí)',
      en: 'Anthropic Academy (free course certificates)',
    },
    note: { vi: 'skilljar', en: 'skilljar' },
  },
  {
    href: 'https://code.claude.com/docs',
    label: { vi: 'Claude Code docs', en: 'Claude Code docs' },
    note: { vi: 'docs', en: 'docs' },
  },
  {
    href: 'https://platform.claude.com/docs',
    label: { vi: 'Claude API docs', en: 'Claude API docs' },
    note: { vi: 'docs', en: 'docs' },
  },
  {
    href: 'https://www.pearsonvue.com/anthropic',
    label: { vi: 'Pearson VUE · Anthropic', en: 'Pearson VUE · Anthropic' },
    note: { vi: 'đặt lịch', en: 'booking' },
  },
]
