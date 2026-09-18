import type { Locale } from '@/lib/i18n'

/**
 * Every user-facing string on `/admin/ccaf`, in both languages.
 *
 * ## Why this page is bilingual when the rest of `(me)` is not
 *
 * `lib/i18n.ts` says the portfolio stays English because its audience is English-reading
 * recruiters. This page has two audiences that do not overlap: the plan is worked through
 * in Vietnamese by the person sitting the exam, and read in English by anyone he shows it
 * to. Translating it was cheaper than picking one of them.
 *
 * `Locale`, `LOCALES` and `LOCALE_LABELS` are reused from `lib/i18n` rather than redeclared
 * - a second `'vi' | 'en'` union that could drift from the first is worth nobody's time -
 * but `swapLocale` is not, because these URLs are `/admin/ccaf` and `/admin/ccaf/en` rather
 * than the `/[lang]/product` shape that function assumes. See the route comment for why.
 *
 * ## Why both languages ship to the browser
 *
 * The page is one client island, so the bundle carries both. That is about 12 KB gzipped
 * of text nobody on a given visit reads. Avoiding it would mean hoisting all content to
 * the server and threading it through four components as props - which buys back the 12 KB
 * and pays for it in an indirection every future edit has to walk through. If this page
 * ever grows a third language, revisit that trade; at two it is not close.
 */

/** A string in every language the page speaks. Both are required, so neither can be missed. */
export type Localized = {
  vi: string
  en: string
}

export function t(value: Localized, locale: Locale): string {
  return value[locale]
}

/** Weekday names, indexed by `Date.prototype.getDay()`. */
export const WEEKDAYS: Record<Locale, readonly string[]> = {
  vi: [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ],
  en: [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
}

export const UI = {
  // --- masthead -------------------------------------------------------------
  eyebrow: {
    vi: 'Claude Certified Architect · Foundations',
    en: 'Claude Certified Architect · Foundations',
  },
  pageTitle: { vi: 'Lộ trình CCA-F', en: 'The CCA-F roadmap' },
  ledeBefore: {
    vi: 'Bốn tuần, 26 ngày, 68 việc - bám Exam Guide v1.0 của Anthropic, khối lượng dồn vào cuối tuần vì trong tuần còn đi làm. Mục tiêu không phải đậu 720, mà là ',
    en: "Four weeks, 26 days, 68 tasks, built around Anthropic's Exam Guide v1.0 and weighted toward the weekends, because the weekdays are work days. The target is not a 720 pass but ",
  },
  ledeAfter: {
    vi: ': đủ biên để một câu đọc nhầm không lật ngược kết quả.',
    en: ': enough margin that one misread question does not decide the outcome.',
  },
  howToReadLabel: { vi: 'Cách đọc trang này.', en: 'How to read this page.' },
  howToRead: {
    vi: 'Mỗi việc bấm vào để mở hướng dẫn từng bước: mở link nào, gõ lệnh gì, và dòng <em>Xong khi</em> cho biết thế nào là làm xong. Phần tham chiếu ở cuối trang - bảng chốt 6 nhóm kiến thức, 12 quy tắc phán đoán, bẫy đáp án - là thứ đọc lại trong năm phút cuối trước khi vào phòng thi.',
    en: 'Click any task to open its steps: which link to open, which command to run, and a <em>Done when</em> line that says what finished actually looks like. The reference at the bottom - six fact groups, twelve judgment rules, the answer traps - is what gets re-read in the last five minutes before the exam.',
  },

  // --- tiles ----------------------------------------------------------------
  tileGoal: { vi: 'Mục tiêu', en: 'Target' },
  tileGoalHint: {
    vi: 'Ngưỡng đậu 720 · 60 câu · 120 phút',
    en: 'Pass mark 720 · 60 questions · 120 minutes',
  },
  tileExamDate: { vi: 'Ngày thi', en: 'Exam date' },
  tileExamDateHintPlain: {
    vi: 'Pearson VUE · đổi lịch miễn phí trước 24 giờ',
    en: 'Pearson VUE · free reschedule up to 24h before',
  },
  tileExamDateHintSuffix: {
    vi: 'nữa · đổi lịch miễn phí trước 24 giờ',
    en: 'away · free reschedule up to 24h before',
  },
  tileDeadline: { vi: 'Deadline công ty', en: 'Employer deadline' },
  tileDeadlineHint: {
    vi: '01/10/2026 · mốc xét Partnership',
    en: '01/10/2026 · Partnership tier review',
  },
  tileProgress: { vi: 'Tiến độ lộ trình', en: 'Roadmap progress' },
  tileReadiness: { vi: 'Sẵn sàng tự chấm', en: 'Self-rated readiness' },
  tileReadinessHint: {
    vi: 'Trung bình 5 domain, có trọng số đề thi',
    en: 'Five domains, weighted by exam share',
  },
  tileStatus: { vi: 'Trạng thái', en: 'Status' },
  tileStatusHintOwner: {
    vi: 'Tự lưu sau mỗi thay đổi',
    en: 'Autosaves on every change',
  },
  tileStatusHintGuest: {
    vi: 'Đăng nhập chủ sở hữu để chỉnh',
    en: 'Sign in as the owner to edit',
  },

  statusIdle: { vi: 'Đã đồng bộ', en: 'In sync' },
  statusSaving: { vi: 'Đang lưu…', en: 'Saving…' },
  statusSaved: { vi: 'Đã lưu', en: 'Saved' },
  statusError: {
    vi: 'Chưa lưu được - thử lại sau',
    en: 'Not saved - will retry',
  },
  statusReadonly: { vi: 'Chỉ xem', en: 'Read-only' },

  daysSuffix: { vi: 'ngày', en: 'days' },
  today: { vi: 'Hôm nay', en: 'Today' },
  past: { vi: 'Đã qua', en: 'Past' },

  // --- plan -----------------------------------------------------------------
  planEyebrow: { vi: 'Kế hoạch', en: 'The plan' },
  planHeading: {
    vi: 'Bốn tuần, từng ngày một',
    en: 'Four weeks, one day at a time',
  },
  weeksNavLabel: { vi: 'Các tuần trong lộ trình', en: 'Weeks in the roadmap' },
  expandAll: { vi: 'Mở tất cả hướng dẫn', en: 'Expand every task' },
  collapseAll: { vi: 'Thu gọn tất cả', en: 'Collapse all' },
  dayLabel: { vi: 'Ngày', en: 'Day' },
  examDayLabel: { vi: 'Thi', en: 'Exam' },
  hoursSuffix: { vi: 'giờ', en: 'h' },
  tasksSuffix: { vi: 'việc', en: 'tasks' },
  statusDone: { vi: 'Xong', en: 'Done' },
  statusBehind: { vi: 'Còn dở', en: 'Behind' },
  doneWhenLabel: { vi: 'Xong khi:', en: 'Done when:' },
  markComplete: { vi: 'Đánh dấu hoàn thành', en: 'Mark complete' },

  // --- rail: readiness ------------------------------------------------------
  readinessTitle: { vi: 'Độ sẵn sàng theo domain', en: 'Readiness by domain' },
  readinessHelp: {
    vi: 'Dải trên là đề thi chia theo trọng số; phần đậm của mỗi khối là mức bạn tự chấm, và cộng lại đúng bằng con số bên cạnh. Số <em>còn</em> ở mỗi dòng là điểm domain đó vẫn đang bỏ trên bàn - học chỗ nào có số lớn thì tổng lên nhanh nhất.',
    en: 'The strip above is the exam split by weight; the solid part of each block is what you have rated yourself, and together they come to exactly the number beside it. The <em>left</em> figure on each row is what that domain is still leaving on the table - study where the figure is biggest and the total moves fastest.',
  },
  readinessTotal: {
    vi: 'Ước lượng theo trọng số đề thi',
    en: 'Weighted against the exam blueprint',
  },
  readinessLeft: { vi: 'còn', en: 'left' },
  confidenceOf: { vi: 'Độ tự tin', en: 'Confidence in' },

  // --- rail: mocks ----------------------------------------------------------
  mocksTitle: { vi: 'Nhật ký đề thi thử', en: 'Practice test log' },
  mocksHelp: {
    vi: 'Chỉ đặt lịch thi khi <strong>2 đề liên tiếp ≥ 80%</strong> và không domain nào dưới 70%. Điểm scaled bên dưới chỉ là ước lượng tuyến tính - Anthropic không công bố công thức quy đổi.',
    en: 'Only book the exam once <strong>two consecutive mocks clear 80%</strong> with no domain under 70%. The scaled score below is a linear stand-in - Anthropic does not publish the real scaling.',
  },
  mockDate: { vi: 'Ngày', en: 'Date' },
  mockLabel: { vi: 'Đề', en: 'Mock' },
  mockLabelPlaceholder: { vi: 'Đề 2', en: 'Mock 2' },
  mockCorrect: { vi: 'Số câu đúng / 60', en: 'Correct answers / 60' },
  mockSubmit: { vi: 'Ghi kết quả', en: 'Log result' },
  mockEmpty: {
    vi: 'Chưa có đề nào được ghi.',
    en: 'No practice tests logged yet.',
  },
  mockDefaultLabel: { vi: 'Đề mới', en: 'New mock' },
  mockRangeError: {
    vi: 'Số câu đúng phải từ 0 đến 60.',
    en: 'Correct answers must be between 0 and 60.',
  },
  mockDelete: { vi: 'Xoá', en: 'Delete' },
  mockDeleteConfirm: {
    vi: 'Xoá kết quả này?',
    en: 'Delete this result?',
  },
  mockDeleteCancel: { vi: 'Giữ lại', en: 'Keep' },

  // --- reference ------------------------------------------------------------
  referenceEyebrow: { vi: 'Bộ tham chiếu', en: 'Reference' },
  referenceHeading: {
    vi: 'Thứ đọc lại năm phút trước khi vào phòng thi',
    en: 'What to re-read five minutes before the exam',
  },
  factsKicker: { vi: 'Bảng chốt', en: 'Cheat sheet' },
  factsTitle: {
    vi: '6 nhóm kiến thức phải nhớ chính xác',
    en: 'Six fact groups worth memorising exactly',
  },
  factsNote: {
    vi: 'sai 1 fact = mất trọn 1 câu',
    en: 'one wrong fact costs a whole question',
  },
  rulesKicker: { vi: 'Nguyên tắc', en: 'Principles' },
  rulesTitle: { vi: '12 quy tắc phán đoán', en: 'Twelve judgment rules' },
  rulesNote: { vi: 'rút từ rationale', en: 'drawn from the rationales' },
  trapsKicker: { vi: 'Bẫy đáp án', en: 'Answer traps' },
  trapsTitle: { vi: 'Thấy là loại ngay', en: 'Eliminate on sight' },
  trapsNote: {
    vi: 'tính năng không tồn tại',
    en: 'features that do not exist',
  },
  trapsIntroBefore: {
    vi: 'Đề trồng phương án nghe rất hợp lý nhưng mô tả thứ không có trong docs. Quy tắc: ',
    en: 'The exam plants options that sound entirely reasonable but name something absent from the docs. The rule: ',
  },
  trapsIntroStrong: {
    vi: 'không thấy trong Exam Guide → loại',
    en: 'not in the Exam Guide, not the answer',
  },
  scopeKicker: { vi: 'Ngoài phạm vi', en: 'Out of scope' },
  scopeTitle: { vi: 'Đừng tốn giờ', en: 'Do not spend hours here' },
  examDayKicker: { vi: 'Ngày thi', en: 'Exam day' },
  examDayTitle: { vi: 'Checklist', en: 'Checklist' },
  resourcesKicker: { vi: 'Tài nguyên', en: 'Resources' },
  resourcesTitle: { vi: 'Mở nhanh', en: 'One click away' },
  newTab: { vi: 'mở tab mới', en: 'opens in a new tab' },
  languageGroup: { vi: 'Ngôn ngữ', en: 'Language' },
} satisfies Record<string, Localized>
