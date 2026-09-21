import type { CareerContent } from '@/lib/mbti/content/types'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * Nghề nghiệp theo từng nhóm tính cách - bản tiếng Việt.
 *
 * Viết tay cho từng nhóm, không sinh tự động. Đây là phần duy nhất trên trang mà nội dung
 * chung chung còn tệ hơn là không có: người tìm "nghề nghiệp phù hợp với ENTJ" muốn một
 * danh sách chỉ đúng với ENTJ, và một danh sách áp được cho cả 16 nhóm là thứ Google phạt.
 *
 * `roles` nghiêng về những vị trí thực sự tồn tại trên thị trường lao động Việt Nam, chứ
 * không dịch nguyên danh sách nghề của tài liệu tiếng Anh.
 *
 * Cả bốn trường đều nói về xu hướng, không phải chỉ định. Nhóm tính cách không quyết định
 * nghề nghiệp, và trang có nói rõ điều đó ngay dưới mục này.
 */
export const CAREERS_VI: Record<MbtiType, CareerContent> = {
  ENTJ: {
    workStyle:
      'Bạn tổ chức công việc quanh mục tiêu và mốc thời gian, và thấy khó chịu khi một cuộc họp kết thúc mà không ai chịu trách nhiệm việc gì. Bạn ra quyết định nhanh, kể cả khi thông tin chưa đủ, vì bạn coi việc đứng yên cũng là một lựa chọn có giá.',
    roles: [
      'Quản lý dự án, trưởng phòng vận hành',
      'Giám đốc điều hành, quản lý cấp trung trở lên',
      'Tư vấn chiến lược, tư vấn quản trị',
      'Sáng lập / đồng sáng lập startup',
      'Quản lý sản phẩm (product manager)',
      'Luật sư doanh nghiệp, pháp chế',
      'Phân tích đầu tư, phát triển kinh doanh',
    ],
    thrivesIn:
      'Nơi có quyền quyết định thật, mục tiêu đo được, và người xung quanh dám phản biện thẳng.',
    drainedBy:
      'Việc lặp lại mà không được thay đổi cách làm, tổ chức mà mọi thứ phải xin phép ba vòng, và những cuộc họp không dẫn tới quyết định nào.',
  },
  INTJ: {
    workStyle:
      'Bạn làm tốt nhất khi được giao một vấn đề khó và đủ thời gian yên tĩnh để dựng mô hình cho nó. Bạn thích sửa nguyên nhân gốc hơn là xử lý triệu chứng, ngay cả khi cách đó lâu hơn.',
    roles: [
      'Kiến trúc sư phần mềm, kỹ sư hệ thống',
      'Nhà khoa học dữ liệu, kỹ sư machine learning',
      'Nghiên cứu viên, giảng viên đại học',
      'Phân tích tài chính, quản lý rủi ro',
      'Chiến lược sản phẩm, phân tích nghiệp vụ',
      'Thiết kế quy trình, tối ưu vận hành',
    ],
    thrivesIn:
      'Công việc có chiều sâu, ít bị ngắt quãng, và được đánh giá bằng chất lượng lời giải chứ không phải số giờ ngồi bàn.',
    drainedBy:
      'Lịch họp dày, phải bán ý tưởng bằng cảm xúc thay vì bằng lập luận, và môi trường mà quan hệ quan trọng hơn năng lực.',
  },
  ENTP: {
    workStyle:
      'Bạn giỏi ở giai đoạn chưa ai biết phải làm gì: nhìn ra góc tiếp cận khác, thử nhanh, bỏ nhanh. Càng về sau, khi công việc chuyển sang duy trì và tối ưu từng phần trăm, bạn càng khó ngồi yên.',
    roles: [
      'Sáng lập startup, phát triển kinh doanh',
      'Tư vấn giải pháp, tư vấn chuyển đổi số',
      'Marketing sáng tạo, chiến lược thương hiệu',
      'Nghiên cứu và phát triển sản phẩm mới',
      'Luật sư tranh tụng, đàm phán hợp đồng',
      'Sáng tạo nội dung, podcast, truyền thông',
    ],
    thrivesIn:
      'Vấn đề mới, đồng nghiệp chịu tranh luận, và quyền thử một thứ chưa ai làm.',
    drainedBy:
      'Quy trình cứng không được đặt câu hỏi, công việc bảo trì kéo dài, và những cuộc họp mà kết luận đã được chốt từ trước.',
  },
  INTP: {
    workStyle:
      'Bạn muốn hiểu hệ thống đến tận gốc trước khi động vào nó, và thường tìm ra lỗ hổng mà người khác đi lướt qua. Bạn làm việc theo đợt: nhiều ngày lửng lơ rồi một đợt tập trung rất sâu.',
    roles: [
      'Lập trình viên, kỹ sư backend',
      'Nghiên cứu khoa học, toán học, thống kê',
      'An ninh mạng, kiểm thử xâm nhập',
      'Phân tích hệ thống, thiết kế cơ sở dữ liệu',
      'Viết tài liệu kỹ thuật',
      'Phân tích dữ liệu, nghiên cứu định lượng',
    ],
    thrivesIn:
      'Bài toán mở, ít họp, và người quản lý đánh giá bạn qua kết quả chứ không qua độ hiện diện.',
    drainedBy:
      'Deadline gấp liên tục, phải quản lý người, và công việc đòi hỏi xã giao nhiều hơn suy nghĩ.',
  },

  ENFJ: {
    workStyle:
      'Bạn đọc được không khí của nhóm và thường là người giữ mọi người đi cùng một hướng. Bạn làm việc qua con người: thuyết phục, kết nối, gỡ mâu thuẫn trước khi nó thành vấn đề.',
    roles: [
      'Giáo viên, giảng viên, đào tạo nội bộ',
      'Quản lý nhân sự, phát triển tổ chức',
      'Huấn luyện viên (coaching), tư vấn hướng nghiệp',
      'Quản lý cộng đồng, truyền thông nội bộ',
      'Quan hệ công chúng, đối ngoại',
      'Quản lý tổ chức phi lợi nhuận, dự án xã hội',
    ],
    thrivesIn:
      'Nơi công việc của bạn có tác động thấy được lên con người, và bạn được tin để dẫn dắt chứ không chỉ thực thi.',
    drainedBy:
      'Môi trường chỉ nhìn vào con số, xung đột kéo dài không ai giải quyết, và việc phải ra quyết định làm tổn thương người khác mà không được giải thích.',
  },
  INFJ: {
    workStyle:
      'Bạn nhìn ra hướng đi trước khi giải thích được vì sao, và thường đúng. Bạn cần thời gian một mình để nghĩ, nhưng thứ bạn nghĩ ra hầu như luôn hướng về người khác.',
    roles: [
      'Tâm lý trị liệu, tham vấn tâm lý',
      'Viết lách, biên tập nội dung',
      'Thiết kế trải nghiệm người dùng (UX)',
      'Nghiên cứu xã hội, nhân học',
      'Giáo dục, thiết kế chương trình học',
      'Công tác xã hội, tổ chức phi lợi nhuận',
    ],
    thrivesIn:
      'Công việc có ý nghĩa rõ ràng, không gian yên tĩnh để suy nghĩ, và mối quan hệ sâu với một nhóm nhỏ thay vì mạng lưới rộng.',
    drainedBy:
      'Văn phòng ồn ào không có chỗ riêng, bán hàng theo chỉ tiêu áp lực, và công việc hời hợt mà bạn không thấy nó phục vụ ai.',
  },
  ENFP: {
    workStyle:
      'Bạn khởi động rất mạnh: ý tưởng, năng lượng, khả năng kéo người khác vào cuộc. Phần khó với bạn là giai đoạn giữa, khi mọi thứ đã rõ và chỉ còn việc làm cho xong.',
    roles: [
      'Sáng tạo nội dung, copywriter',
      'Marketing, truyền thông thương hiệu',
      'Đào tạo, thiết kế hoạt động trải nghiệm',
      'Khởi nghiệp xã hội, gây quỹ',
      'Tư vấn hướng nghiệp, tuyển dụng',
      'Thiết kế, sản xuất chương trình',
    ],
    thrivesIn:
      'Dự án mới, nhiều người, và đủ tự do để đổi cách làm giữa chừng khi bạn thấy cách hay hơn.',
    drainedBy:
      'Công việc lặp lại từng ngày, quy tắc không ai giải thích được lý do, và làm một mình quá lâu.',
  },
  INFP: {
    workStyle:
      'Bạn làm được nhiều nhất khi tin vào thứ mình đang làm, và gần như không thể ép mình làm tốt một việc trái với giá trị của bản thân. Bạn kỹ tính với chất lượng theo tiêu chuẩn riêng, không theo tiêu chuẩn của người chấm.',
    roles: [
      'Viết văn, viết nội dung, biên tập',
      'Biên dịch, hiệu đính',
      'Thiết kế đồ họa, minh họa',
      'Tham vấn tâm lý, công tác xã hội',
      'Giáo dục, đặc biệt là giáo dục đặc biệt',
      'Tổ chức phi lợi nhuận, dự án cộng đồng',
    ],
    thrivesIn:
      'Công việc gắn với điều bạn thật sự quan tâm, nhịp độ tự chủ, và người quản lý góp ý riêng thay vì phê bình trước đám đông.',
    drainedBy:
      'Môi trường cạnh tranh nội bộ gay gắt, phải bảo vệ thứ mình không tin, và bị đánh giá liên tục bằng chỉ số ngắn hạn.',
  },

  ESTJ: {
    workStyle:
      'Bạn biến một mớ việc lộn xộn thành quy trình chạy được, và giữ cho nó chạy. Bạn nói thẳng khi thấy sai, và mong người khác cũng vậy.',
    roles: [
      'Quản lý vận hành, quản lý sản xuất',
      'Quản lý dự án, điều phối chuỗi cung ứng',
      'Kế toán trưởng, kiểm soát nội bộ',
      'Ngân hàng, quản lý chi nhánh',
      'Quân đội, công an, quản lý an toàn',
      'Quản lý cửa hàng, quản lý bán hàng khu vực',
    ],
    thrivesIn:
      'Tổ chức có trách nhiệm rõ ràng, tiêu chuẩn đo được, và thẩm quyền tương xứng với việc bạn phải chịu trách nhiệm.',
    drainedBy:
      'Mục tiêu mơ hồ, người không giữ cam kết, và những cuộc bàn ý tưởng kéo dài mà không ai chốt.',
  },
  ISTJ: {
    workStyle:
      'Bạn làm đúng, làm đủ, và làm được lâu dài. Bạn nhớ chi tiết người khác quên, và thường là người phát hiện ra con số không khớp.',
    roles: [
      'Kiểm toán, kế toán',
      'Pháp lý, tuân thủ (compliance)',
      'Quản trị hệ thống, vận hành hạ tầng',
      'Kiểm định chất lượng (QA/QC)',
      'Hành chính, quản lý hồ sơ',
      'Phân tích dữ liệu, báo cáo tài chính',
    ],
    thrivesIn:
      'Công việc có chuẩn rõ ràng, kỳ vọng ổn định, và thời gian đủ để làm cho đúng ngay từ đầu.',
    drainedBy:
      'Yêu cầu thay đổi liên tục giữa chừng, phải ứng biến không có dữ liệu, và môi trường coi nhẹ sai sót nhỏ.',
  },
  ESFJ: {
    workStyle:
      'Bạn để ý ai đang gặp khó trước khi họ nói ra, và thường là chất keo giữ một nhóm không rã. Bạn làm việc tốt nhất khi biết rõ mình đang giúp ai.',
    roles: [
      'Nhân sự, tuyển dụng, phúc lợi nhân viên',
      'Điều dưỡng, kỹ thuật viên y tế',
      'Giáo viên mầm non, tiểu học',
      'Chăm sóc khách hàng, quản lý dịch vụ',
      'Tổ chức sự kiện, hành chính văn phòng',
      'Bán lẻ, quản lý cửa hàng',
    ],
    thrivesIn:
      'Nhóm gắn bó, quy trình rõ ràng, và công việc mà kết quả tốt đồng nghĩa với việc có người được giúp.',
    drainedBy:
      'Môi trường lạnh nhạt hoặc nhiều mâu thuẫn ngầm, làm việc một mình dài ngày, và bị đánh giá mà không được ghi nhận phần chăm lo cho người khác.',
  },
  ISFJ: {
    workStyle:
      'Bạn giữ mọi thứ chạy êm bằng cách âm thầm xử lý những việc không ai giao. Bạn ít khi đòi công, nên phần đóng góp của bạn thường bị nhìn thiếu.',
    roles: [
      'Điều dưỡng, chăm sóc sức khỏe',
      'Trợ lý, thư ký, hành chính nhân sự',
      'Giáo viên, trợ giảng',
      'Thư viện, lưu trữ, quản lý tài liệu',
      'Kế toán, kiểm soát chứng từ',
      'Chăm sóc khách hàng, hỗ trợ kỹ thuật',
    ],
    thrivesIn:
      'Nơi ổn định, kỳ vọng rõ, và có người ghi nhận phần việc bạn làm mà không ai yêu cầu.',
    drainedBy:
      'Xung đột công khai, thay đổi đột ngột không được báo trước, và bị đẩy vào vai trò phải tranh giành sự chú ý.',
  },

  ESTP: {
    workStyle:
      'Bạn xử lý tình huống thật tốt hơn hẳn xử lý kế hoạch trên giấy. Khi mọi thứ hỏng, bạn là người phản ứng nhanh nhất trong phòng.',
    roles: [
      'Kinh doanh, bán hàng trực tiếp',
      'Bất động sản, môi giới',
      'Khởi nghiệp, quản lý cửa hàng',
      'Cứu hộ, an ninh, huấn luyện thể thao',
      'Đàm phán thương mại, thu mua',
      'Tổ chức sự kiện, sản xuất hiện trường',
    ],
    thrivesIn:
      'Công việc có nhịp nhanh, kết quả thấy ngay, và thù lao gắn với hiệu quả thật chứ không theo thâm niên.',
    drainedBy:
      'Bàn giấy, họp lý thuyết dài dòng, và kế hoạch năm năm cho thứ chưa chắc tồn tại tháng sau.',
  },
  ISTP: {
    workStyle:
      'Bạn học bằng cách tháo ra xem bên trong. Bạn nói ít, nhưng khi một thứ hỏng thì bạn là người tìm ra nguyên nhân trong khi mọi người còn đang bàn.',
    roles: [
      'Kỹ sư cơ khí, kỹ sư điện',
      'Kỹ thuật viên bảo trì, vận hành máy',
      'An ninh mạng, quản trị mạng',
      'Phi công, kỹ thuật hàng không',
      'Kỹ thuật ô tô, chế tạo',
      'Giám định, pháp y kỹ thuật',
    ],
    thrivesIn:
      'Việc thực tế, công cụ tốt, và được để yên cho làm sau khi đã hiểu vấn đề.',
    drainedBy:
      'Họp dài không có kết luận, quy trình giấy tờ rườm rà, và môi trường đòi hỏi phải nói về cảm xúc thường xuyên.',
  },
  ESFP: {
    workStyle:
      'Bạn làm việc bằng năng lượng và sự có mặt: khách hàng nhớ bạn, đồng nghiệp thấy dễ chịu khi có bạn trong ca. Bạn giỏi hiện tại hơn giỏi lập kế hoạch dài.',
    roles: [
      'Biểu diễn, MC, dẫn chương trình',
      'Du lịch, lữ hành, quản lý khách sạn',
      'Nhà hàng, F&B, quản lý dịch vụ',
      'Bán hàng, chăm sóc khách hàng',
      'Tổ chức sự kiện, hoạt náo',
      'Thời trang, làm đẹp, thiết kế trưng bày',
    ],
    thrivesIn:
      'Nơi có người, có nhịp, và kết quả nhìn thấy được trong ngày chứ không phải trong quý.',
    drainedBy:
      'Ngồi một mình với bảng tính, dự án dài không thấy kết quả, và môi trường quá trang trọng.',
  },
  ISFP: {
    workStyle:
      'Bạn làm ra thứ có thẩm mỹ riêng và không thích bị bảo phải làm theo khuôn. Bạn ít tranh luận, nhưng cũng ít khi đổi ý về thứ mình thấy là đúng.',
    roles: [
      'Thiết kế đồ họa, thiết kế nội thất',
      'Nhiếp ảnh, quay dựng',
      'Ẩm thực, bếp, pha chế',
      'Thời trang, thủ công mỹ nghệ',
      'Vật lý trị liệu, trị liệu nghệ thuật',
      'Làm vườn, cảnh quan, chăm sóc động vật',
    ],
    thrivesIn:
      'Công việc tạo ra thứ cụ thể, nhịp độ tự chủ, và người quản lý tin vào gu của bạn.',
    drainedBy:
      'Cạnh tranh gay gắt, quy trình cứng nhắc, và bị phê bình gay gắt trước mặt người khác.',
  },
}
