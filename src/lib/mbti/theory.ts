import type { Locale } from '@/lib/i18n'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * The theory behind a type code, derived rather than authored per type.
 *
 * Sixteen type pages need depth to compete for queries like "ENTJ là gì" or "hàm nhận
 * thức INFJ", and hand-writing that depth is 16 x 2 essays whose quality would drift. Both
 * blocks here are *composed* instead: eight letter definitions and eight function
 * definitions per locale expand into all 32 pages, and every statement is standard MBTI
 * theory rather than something invented for one type.
 *
 * That distinction matters for search too. Google's helpful-content system penalises pages
 * padded with generic filler; it does not penalise a correct, consistent explanation of
 * the framework the page is about.
 */

// MARK: Letters

export type Letter = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'

type LetterCopy = { name: string; summary: string }

/**
 * What each of the four positions in a type code means.
 *
 * Written to answer the question directly - someone searching "chữ N trong MBTI là gì"
 * wants a sentence, not a paragraph of preamble.
 */
export const LETTERS: Record<Locale, Record<Letter, LetterCopy>> = {
  vi: {
    E: {
      name: 'Hướng ngoại (Extraversion)',
      summary:
        'Bạn lấy lại năng lượng từ tương tác bên ngoài. Suy nghĩ thường rõ ràng hơn khi được nói ra, và im lặng quá lâu khiến bạn thấy cạn chứ không thấy đầy.',
    },
    I: {
      name: 'Hướng nội (Introversion)',
      summary:
        'Bạn lấy lại năng lượng từ không gian riêng. Bạn xử lý bên trong trước rồi mới nói, nên thường phát biểu sau người khác nhưng đã cân nhắc kỹ hơn.',
    },
    S: {
      name: 'Giác quan (Sensing)',
      summary:
        'Bạn tin vào những gì quan sát được: chi tiết cụ thể, kinh nghiệm đã có, dữ liệu trước mắt. Bạn muốn biết chuyện gì đang thực sự xảy ra trước khi bàn chuyện nó có thể thành gì.',
    },
    N: {
      name: 'Trực giác (Intuition)',
      summary:
        'Bạn chú ý tới mô hình và khả năng phía sau chi tiết. Bạn thấy mối liên hệ giữa những thứ tưởng như rời rạc, và dễ chán khi phải ở lại quá lâu với phần cụ thể.',
    },
    T: {
      name: 'Lý trí (Thinking)',
      summary:
        'Bạn quyết định dựa trên tính nhất quán và logic. Bạn hỏi "điều này có đúng không" trước khi hỏi "điều này ảnh hưởng ai", kể cả khi câu trả lời không dễ nghe.',
    },
    F: {
      name: 'Cảm xúc (Feeling)',
      summary:
        'Bạn quyết định dựa trên giá trị và tác động lên con người. Bạn cân nhắc ai bị ảnh hưởng và mối quan hệ sẽ ra sao, chứ không chỉ phương án nào tối ưu trên giấy.',
    },
    J: {
      name: 'Nguyên tắc (Judging)',
      summary:
        'Bạn thích mọi thứ được chốt. Kế hoạch, thời hạn và quyết định đã xong khiến bạn nhẹ đầu; việc để ngỏ quá lâu làm bạn khó chịu.',
    },
    P: {
      name: 'Linh hoạt (Perceiving)',
      summary:
        'Bạn thích giữ lựa chọn mở. Bạn làm tốt khi còn chỗ để điều chỉnh, và một kế hoạch chốt quá sớm khiến bạn thấy bị bó.',
    },
  },
  en: {
    E: {
      name: 'Extraversion',
      summary:
        'You recharge through interaction with the world outside you. Thoughts tend to clarify as you say them, and too much quiet drains rather than fills you.',
    },
    I: {
      name: 'Introversion',
      summary:
        'You recharge in your own space. You process internally before speaking, so you often arrive later in a conversation but with more considered.',
    },
    S: {
      name: 'Sensing',
      summary:
        'You trust what you can observe: concrete detail, lived experience, the data in front of you. You want to know what is actually happening before discussing what it might become.',
    },
    N: {
      name: 'Intuition',
      summary:
        'You notice the pattern and the possibility behind the detail. You see links between things that look unrelated, and get restless staying too long in the specifics.',
    },
    T: {
      name: 'Thinking',
      summary:
        'You decide on consistency and logic. You ask whether something is sound before you ask who it affects, even when the answer is unwelcome.',
    },
    F: {
      name: 'Feeling',
      summary:
        'You decide on values and human impact. You weigh who is affected and what it does to the relationship, not only which option is optimal on paper.',
    },
    J: {
      name: 'Judging',
      summary:
        'You like things settled. Plans, deadlines and closed decisions clear your head; leaving something open too long sits badly with you.',
    },
    P: {
      name: 'Perceiving',
      summary:
        'You like options open. You work best with room to adjust, and a plan locked down too early feels like a cage.',
    },
  },
}

/** The four letters of a type code, in order, with their meanings. */
export function lettersOf(
  locale: Locale,
  type: MbtiType
): { letter: Letter; name: string; summary: string }[] {
  return (type.split('') as Letter[]).map(letter => ({
    letter,
    ...LETTERS[locale][letter],
  }))
}

// MARK: Cognitive functions

export type CognitiveFunction = 'Te' | 'Ti' | 'Fe' | 'Fi' | 'Se' | 'Si' | 'Ne' | 'Ni'

/** Position in the stack. Each has a distinct role, which is the useful part. */
export type FunctionRole = 'dominant' | 'auxiliary' | 'tertiary' | 'inferior'

const OPPOSITE: Record<string, string> = { T: 'F', F: 'T', S: 'N', N: 'S' }

/**
 * Derives the four-function stack from a type code.
 *
 * The rules are deterministic, which is why this is computed rather than tabulated:
 *
 * 1. The last letter says which *kind* of function faces the outer world. `J` extraverts
 *    the judging function (T/F); `P` extraverts the perceiving function (S/N).
 * 2. The first letter says whether the dominant function is the extraverted one. An `E`
 *    leads with the outward-facing function; an `I` leads with the inward-facing one and
 *    the outward one becomes auxiliary.
 * 3. Tertiary is the auxiliary's opposite function with the opposite attitude; inferior is
 *    the dominant's opposite with the opposite attitude.
 *
 * Verified against the published stacks for all sixteen types - see
 * `tests/unit/mbti-theory.test.ts`, which pins every one. A subtly wrong rule here would
 * put confidently incorrect theory on 32 indexed pages, which is worse than omitting it.
 */
export function functionStack(type: MbtiType): { role: FunctionRole; fn: CognitiveFunction }[] {
  const [ei, sn, tf, jp] = type.split('')

  const extraverted = jp === 'J' ? tf : sn
  const introverted = jp === 'J' ? sn : tf

  const dominant = ei === 'E' ? `${extraverted}e` : `${introverted}i`
  const auxiliary = ei === 'E' ? `${introverted}i` : `${extraverted}e`
  const tertiary = `${OPPOSITE[auxiliary[0]]}${auxiliary[1] === 'e' ? 'i' : 'e'}`
  const inferior = `${OPPOSITE[dominant[0]]}${dominant[1] === 'e' ? 'i' : 'e'}`

  return [
    { role: 'dominant', fn: dominant as CognitiveFunction },
    { role: 'auxiliary', fn: auxiliary as CognitiveFunction },
    { role: 'tertiary', fn: tertiary as CognitiveFunction },
    { role: 'inferior', fn: inferior as CognitiveFunction },
  ]
}

export const FUNCTION_COPY: Record<Locale, Record<CognitiveFunction, LetterCopy>> = {
  vi: {
    Te: {
      name: 'Tư duy hướng ngoại (Te)',
      summary: 'Sắp xếp thế giới bên ngoài cho hiệu quả: mục tiêu, quy trình, kết quả đo được.',
    },
    Ti: {
      name: 'Tư duy hướng nội (Ti)',
      summary: 'Xây một hệ thống logic nhất quán bên trong và kiểm tra mọi thứ dựa trên nó.',
    },
    Fe: {
      name: 'Cảm xúc hướng ngoại (Fe)',
      summary: 'Đọc và điều hòa cảm xúc của nhóm, giữ cho mối quan hệ chung không đứt gãy.',
    },
    Fi: {
      name: 'Cảm xúc hướng nội (Fi)',
      summary: 'Đối chiếu mọi việc với hệ giá trị riêng, rất khó thỏa hiệp khi thấy sai.',
    },
    Se: {
      name: 'Giác quan hướng ngoại (Se)',
      summary: 'Bắt nhịp với hiện tại và phản ứng nhanh với những gì đang thực sự diễn ra.',
    },
    Si: {
      name: 'Giác quan hướng nội (Si)',
      summary: 'So sánh hiện tại với kinh nghiệm đã có, nhớ chi tiết và tin vào cái đã kiểm chứng.',
    },
    Ne: {
      name: 'Trực giác hướng ngoại (Ne)',
      summary: 'Bung ra nhiều khả năng từ một tình huống, liên tục hỏi "còn cách nào khác".',
    },
    Ni: {
      name: 'Trực giác hướng nội (Ni)',
      summary: 'Gom nhiều tín hiệu rời rạc thành một hướng đi duy nhất, thường trước khi giải thích được.',
    },
  },
  en: {
    Te: {
      name: 'Extraverted Thinking (Te)',
      summary: 'Organises the outside world for efficiency: goals, process, measurable outcomes.',
    },
    Ti: {
      name: 'Introverted Thinking (Ti)',
      summary: 'Builds one internally consistent logical system and tests everything against it.',
    },
    Fe: {
      name: 'Extraverted Feeling (Fe)',
      summary: 'Reads and regulates the mood of a group, keeping the shared relationship intact.',
    },
    Fi: {
      name: 'Introverted Feeling (Fi)',
      summary: 'Checks everything against a private value system, and will not compromise it easily.',
    },
    Se: {
      name: 'Extraverted Sensing (Se)',
      summary: 'Tunes into the present moment and responds fast to what is actually happening.',
    },
    Si: {
      name: 'Introverted Sensing (Si)',
      summary: 'Compares now against remembered experience, holding detail and trusting what is proven.',
    },
    Ne: {
      name: 'Extraverted Intuition (Ne)',
      summary: 'Fans one situation out into many possibilities, always asking what else it could be.',
    },
    Ni: {
      name: 'Introverted Intuition (Ni)',
      summary: 'Converges scattered signals into a single direction, often before it can be explained.',
    },
  },
}

export const ROLE_COPY: Record<Locale, Record<FunctionRole, string>> = {
  vi: {
    dominant: 'Chủ đạo',
    auxiliary: 'Hỗ trợ',
    tertiary: 'Thứ ba',
    inferior: 'Kém phát triển',
  },
  en: {
    dominant: 'Dominant',
    auxiliary: 'Auxiliary',
    tertiary: 'Tertiary',
    inferior: 'Inferior',
  },
}

export const ROLE_HINT: Record<Locale, Record<FunctionRole, string>> = {
  vi: {
    dominant: 'Cách bạn vận hành mặc định, mạnh nhất và tự nhiên nhất.',
    auxiliary: 'Chỗ dựa thứ hai, cân bằng lại cho hàm chủ đạo.',
    tertiary: 'Phát triển muộn hơn, thường bật lên khi bạn thoải mái.',
    inferior: 'Điểm yếu cố hữu, hay lộ ra khi bạn căng thẳng hoặc mệt.',
  },
  en: {
    dominant: 'Your default mode - the strongest and most automatic.',
    auxiliary: 'The second support, balancing out the dominant.',
    tertiary: 'Develops later, and tends to surface when you are relaxed.',
    inferior: 'The persistent blind spot, most visible under stress or exhaustion.',
  },
}
