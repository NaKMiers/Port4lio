import type { QuestionContent } from '@/lib/mbti/content/types'

/**
 * Vietnamese wording for the 60 questions, keyed by `Question.id`.
 *
 * Written as natural Vietnamese, not a word-for-word rendering of the English file. The
 * two versions ask the same thing; they do not use the same sentence structure, because a
 * translated-sounding test reads as untrustworthy and people abandon it.
 *
 * Answer `a` always scores the FIRST pole of the axis (E, S, T, J), `b` the second
 * (I, N, F, P) - the same contract as every other locale file. Swapping them here would
 * silently invert an axis for Vietnamese users only.
 */
export const QUESTIONS_VI: Record<number, QuestionContent> = {
  // --- E / I ---
  1: {
    prompt: 'Sau một tuần dài, bạn lấy lại năng lượng bằng cách',
    a: 'ra ngoài gặp gỡ mọi người',
    b: 'dành thời gian một mình',
  },
  5: {
    prompt: 'Ở một buổi tiệc mà bạn hầu như không quen ai, bạn sẽ',
    a: 'chủ động bắt chuyện với người lạ',
    b: 'đi cùng người mà bạn đến chung',
  },
  9: {
    prompt: 'Khi có tin vui, bạn thường',
    a: 'kể ngay cho ai đó',
    b: 'giữ lại một lúc cho riêng mình',
  },
  13: {
    prompt: 'Trong một cuộc thảo luận nhóm, bạn',
    a: 'vừa nói vừa nghĩ',
    b: 'nghĩ xong rồi mới nói',
  },
  17: {
    prompt: 'Cuối tuần lý tưởng của bạn là',
    a: 'có hẹn với vài người',
    b: 'có nhiều khoảng trống không lịch trình',
  },
  21: {
    prompt: 'Khi bí một vấn đề khó, bạn muốn',
    a: 'nói ra với ai đó để gỡ',
    b: 'tự mình ngồi nghĩ cho ra',
  },
  25: {
    prompt: 'Một ngày kín lịch họp làm bạn thấy',
    a: 'hào hứng',
    b: 'kiệt sức',
  },
  29: {
    prompt: 'Người lạ ngồi cạnh bạn trên một chuyến đi dài. Bạn',
    a: 'bắt chuyện',
    b: 'đeo tai nghe vào',
  },
  33: {
    prompt: 'Trong một nhóm mới, mọi người hiểu bạn',
    a: 'khá nhanh',
    b: 'khá chậm',
  },
  37: {
    prompt: 'Khoảng lặng giữa cuộc trò chuyện với bạn là',
    a: 'điều cần lấp đầy',
    b: 'điều hoàn toàn dễ chịu',
  },
  41: {
    prompt: 'Bạn muốn có',
    a: 'nhiều mối quan hệ thân thiện',
    b: 'vài người bạn thật sự sâu sắc',
  },
  45: {
    prompt: 'Khi có chuyện buồn, bạn',
    a: 'cần nói ra với ai đó',
    b: 'cần ở một mình trước đã',
  },
  49: {
    prompt: 'Điện thoại reo từ một số lạ. Bạn',
    a: 'nghe máy',
    b: 'để nó tự tắt',
  },
  53: {
    prompt: 'Ở một buổi workshop, bạn học được nhiều hơn từ',
    a: 'phần làm việc nhóm',
    b: 'phần tự làm một mình',
  },
  57: {
    prompt: 'Sau một cuộc trò chuyện dài và vui, bạn thấy',
    a: 'phấn chấn hẳn lên',
    b: 'muốn tìm chỗ yên tĩnh',
  },

  // --- S / N ---
  2: {
    prompt: 'Bạn tin vào',
    a: 'những gì quan sát được trực tiếp',
    b: 'linh cảm về điều sắp tới',
  },
  6: {
    prompt: 'Cầm một bản hướng dẫn, bạn',
    a: 'làm theo từng bước',
    b: 'đọc lướt rồi tự mò',
  },
  10: {
    prompt: 'Bạn bị cuốn vào',
    a: 'chi tiết thực tế',
    b: 'ý tưởng lớn phía sau',
  },
  14: {
    prompt: 'Khi ai đó trình bày một kế hoạch, bạn muốn nghe trước',
    a: 'các chi tiết cụ thể',
    b: 'ý nghĩa của việc này',
  },
  18: {
    prompt: 'Kể lại một chuyện đã xảy ra, bạn nói về',
    a: 'chuyện đó diễn ra thế nào',
    b: 'chuyện đó có ý nghĩa gì',
  },
  22: {
    prompt: 'Bạn muốn làm việc với thứ gì đó',
    a: 'cụ thể và có thật',
    b: 'chưa chắc chắn nhưng có tiềm năng',
  },
  26: {
    prompt: 'Bạn thường để ý',
    a: 'những gì đang có ở đó',
    b: 'những gì nó có thể trở thành',
  },
  30: {
    prompt: 'Trí nhớ của bạn giữ lại',
    a: 'dữ kiện và chi tiết',
    b: 'cảm giác và mối liên hệ',
  },
  34: {
    prompt: 'Một ý tưởng hay là ý tưởng',
    a: 'dùng được ngay bây giờ',
    b: 'mở ra được điều gì đó',
  },
  38: {
    prompt: 'Bạn thấy an tâm hơn với',
    a: 'cách làm đã được kiểm chứng',
    b: 'cách chưa ai thử nhưng có thể tốt hơn',
  },
  42: {
    prompt: 'Khi nấu ăn, bạn',
    a: 'làm theo công thức',
    b: 'tự gia giảm theo cảm giác',
  },
  46: {
    prompt: 'Đầu bạn thường',
    a: 'ở ngay chuyện trước mắt',
    b: 'đi trước một đoạn',
  },
  50: {
    prompt: 'Trong bảo tàng, bạn',
    a: 'đọc phần chú thích',
    b: 'chỉ đứng ngắm',
  },
  54: { prompt: 'Bạn thấy mình thiên về', a: 'thực tế', b: 'giàu tưởng tượng' },
  58: { prompt: 'Với bạn, dữ kiện là', a: 'điểm kết luận', b: 'điểm bắt đầu' },

  // --- T / F ---
  3: {
    prompt: 'Khi bạn bè kể một vấn đề, việc đầu tiên bạn làm là',
    a: 'giúp họ tìm cách giải quyết',
    b: 'để họ thấy được lắng nghe',
  },
  7: {
    prompt: 'Một quyết định tốt là quyết định',
    a: 'hợp lý về mặt logic',
    b: 'đúng với những người liên quan',
  },
  11: {
    prompt: 'Bạn muốn người khác thấy mình là người',
    a: 'công bằng',
    b: 'tử tế',
  },
  15: {
    prompt: 'Khi phải góp ý nặng, bạn',
    a: 'nói thẳng',
    b: 'nói khéo để người ta dễ nghe',
  },
  19: {
    prompt: 'Trong một cuộc tranh luận, bạn tập trung vào',
    a: 'ai đúng',
    b: 'mọi người đang cảm thấy thế nào',
  },
  23: {
    prompt: 'Bạn đánh giá một kế hoạch dựa trên',
    a: 'nó có đứng vững không',
    b: 'nó ảnh hưởng tới con người ra sao',
  },
  27: {
    prompt: 'Bị chê về công việc, bạn thấy đó là',
    a: 'thứ hữu ích',
    b: 'chuyện cá nhân',
  },
  31: {
    prompt: 'Khi có mâu thuẫn trong công việc, bạn tìm',
    a: 'câu trả lời khách quan nhất',
    b: 'cách giữ được cả đội',
  },
  35: {
    prompt: 'Quy định nên được',
    a: 'áp dụng nhất quán',
    b: 'linh hoạt khi hoàn cảnh cần',
  },
  39: { prompt: 'Bạn coi trọng', a: 'sự thật', b: 'sự hòa thuận' },
  43: {
    prompt: 'Xem một bộ phim buồn, bạn',
    a: 'vẫn giữ một khoảng cách',
    b: 'bị cuốn vào hoàn toàn',
  },
  47: {
    prompt: 'Khi ai đó bật khóc, phản xạ của bạn là',
    a: 'tìm hiểu nguyên nhân',
    b: 'dỗ dành họ',
  },
  51: {
    prompt: 'Quyết định của cả nhóm nên dựa vào',
    a: 'lập luận thuyết phục nhất',
    b: 'sự đồng thuận rộng nhất',
  },
  55: {
    prompt: 'Bạn muốn người ta nói với mình',
    a: 'điều thật lòng',
    b: 'điều khiến mình vững tâm',
  },
  59: {
    prompt: 'Bạn tin vào',
    a: 'phân tích của mình',
    b: 'cảm nhận của mình về con người',
  },

  // --- J / P ---
  4: {
    prompt: 'Một chuyến đi sẽ hay hơn khi',
    a: 'được lên lịch sẵn',
    b: 'để ngỏ, tới đâu hay tới đó',
  },
  8: {
    prompt: 'Với một hạn chót, bạn',
    a: 'làm xong từ sớm',
    b: 'làm dồn vào lúc gần hết hạn',
  },
  12: {
    prompt: 'Chỗ làm việc của bạn thường',
    a: 'gọn gàng, có thứ tự',
    b: 'bừa nhưng bạn vẫn làm việc tốt',
  },
  16: {
    prompt: 'Bạn thấy dễ chịu hơn khi một quyết định',
    a: 'đã chốt',
    b: 'vẫn còn để ngỏ',
  },
  20: {
    prompt: 'Danh sách việc cần làm với bạn là',
    a: 'cách bạn làm việc',
    b: 'thứ bạn viết ra rồi để lạc đâu mất',
  },
  24: {
    prompt: 'Kế hoạch bị đổi vào phút chót làm bạn thấy',
    a: 'khó chịu',
    b: 'bình thường, đôi khi còn hay hơn',
  },
  28: {
    prompt: 'Bạn muốn',
    a: 'biết trước ngày mai có gì',
    b: 'xem ngày mai mang đến điều gì',
  },
  32: {
    prompt: 'Bắt đầu một dự án mới, bạn',
    a: 'phác ra kế hoạch trước',
    b: 'nhảy vào làm luôn',
  },
  36: {
    prompt: 'Những việc còn dang dở',
    a: 'làm bạn khó chịu trong đầu',
    b: 'không làm bạn bận tâm mấy',
  },
  40: {
    prompt: 'Bạn soạn hành lý',
    a: 'trước vài ngày',
    b: 'tối hôm trước khi đi',
  },
  44: {
    prompt: 'Sự lặp lại đều đặn làm bạn thấy',
    a: 'vững vàng',
    b: 'tù túng',
  },
  48: {
    prompt: 'Khi đi mua sắm, bạn',
    a: 'mang theo danh sách',
    b: 'xem có gì thì mua',
  },
  52: {
    prompt: 'Bạn muốn lịch của mình',
    a: 'kín và rõ ràng',
    b: 'phần lớn để trống',
  },
  56: {
    prompt: 'Luật chơi của một trò chơi nên được',
    a: 'thống nhất trước khi bắt đầu',
    b: 'vừa chơi vừa thống nhất',
  },
  60: {
    prompt: 'Bạn hoàn thành mọi thứ',
    a: 'trước khi tới hạn',
    b: 'đúng vào lúc buộc phải xong',
  },
}
