import type { TypeContent } from '@/lib/mbti/content/types'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * Vietnamese content for the 16 type pages.
 *
 * Same substance as `types.en.ts`, written natively rather than translated.
 *
 * `nickname` is Vietnamese. An earlier version left these in English on the theory that
 * "The Teacher" is recognisable to a Vietnamese reader too; that was wrong in practice -
 * an otherwise fully Vietnamese page with sixteen English labels down the middle reads as
 * a half-finished translation. These use the names Vietnamese MBTI material actually uses
 * rather than word-for-word renderings, so ISFP is "Người nghệ sĩ" and not "Nhà soạn nhạc".
 *
 * Same tone rule as the English file: name the cost of each strength. A page that only
 * flatters reads as a horoscope, and this page has to earn enough trust to sell a report.
 */
export const TYPES_VI: Record<MbtiType, TypeContent> = {
  ENFJ: {
    nickname: 'Người dẫn dắt',
    tagline:
      'Bạn đọc được không khí căn phòng trước khi đọc chương trình họp, và thường đã biết ai đang cần giúp.',
    overview: [
      'Bạn nhận ra người khác cần gì trước khi họ nói ra, và rất khó để bạn ngồi yên với điều đó. Trong một nhóm, bạn thường là người giữ mọi thứ gắn kết gần như theo phản xạ, và ít ai gọi tên việc đó vì bạn làm nó trông quá nhẹ nhàng.',
      'Cái giá là sự chú ý của bạn luôn hướng ra ngoài. Bạn có thể dành cả tuần gỡ rối cho người khác, rồi đến Chủ nhật mới nhận ra mình chưa nghĩ gì cho bản thân.',
    ],
    strengths: [
      'Bạn biết một nhóm đang thực sự cảm thấy gì, không phải đang nói gì',
      'Người ta tin bạn nhanh và kể cho bạn những chuyện thật',
      'Bạn biến một ý định chung mơ hồ thành việc mọi người thực sự làm',
      'Bạn góp ý nặng theo cách người nghe tiếp nhận được mà không tổn thương',
    ],
    growth: [
      'Từ chối mà không cần dựng sẵn một lý do chính đáng',
      'Để người khác tự vật lộn khi chính sự vật lộn đó mới là điều họ cần',
      'Nhận ra khi nào "giúp người" đã thành cách né việc của chính mình',
    ],
    inRelationships:
      'Bạn đầu tư sớm và sâu, điều đó rất quý và đôi khi hơi nhiều với người đi chậm hơn. Khoảnh khắc khó nhất của bạn là nhận ra được cần đến và được yêu thương không phải là một.',
  },
  ENFP: {
    nickname: 'Người truyền cảm hứng',
    tagline:
      'Bạn tìm ra được điểm thú vị trong hầu như mọi thứ, và đó là lý do bạn đã bắt đầu rất nhiều dự án.',
    overview: [
      'Khả năng là thứ khiến bạn chuyển động. Một cuộc trò chuyện về việc thứ gì đó có thể trở thành gì sẽ giữ bạn lâu hơn nhiều so với việc nó đang là gì, và bạn thật sự giỏi trong việc làm người khác nhìn thấy điều đó.',
      'Cũng chính điều đó khiến việc kết thúc trở nên khó. Ý tưởng sống động nhất ở lúc bắt đầu, và đến khoảng giữa nó đã thành công việc hậu cần, đúng phần mà sự chú ý của bạn hay trượt đi.',
    ],
    strengths: [
      'Bạn thấy tiềm năng ở người khác trước cả khi họ tự thấy',
      'Bạn nối được những ý tưởng tưởng như chẳng liên quan',
      'Sự hào hứng của bạn là thật và nó kéo được người khác đi theo',
      'Bạn thoải mái đổi ý một cách hiếm thấy',
    ],
    growth: [
      'Làm xong một việc trước khi ý tưởng tiếp theo xuất hiện',
      'Ngồi lại với khúc giữa buồn tẻ thay vì trốn sang một khởi đầu mới',
      'Phân biệt giữa cơ hội thật và thứ chỉ đơn giản là mới lạ',
    ],
    inRelationships:
      'Bạn mang đến năng lượng và sự tò mò thật lòng về con người đối phương. Điểm vướng là sự đều đặn: người gần bạn nhất cần phiên bản chú ý của bạn vào một ngày thứ Ba bình thường, không chỉ phiên bản rực rỡ của những buổi tối đẹp.',
  },
  ENTJ: {
    nickname: 'Nhà điều hành',
    tagline:
      'Bạn nhìn ra chuyện này sẽ đi tới đâu và đã phân xong ai làm việc gì.',
    overview: [
      'Bạn sắp xếp theo bản năng. Đưa cho bạn một tình huống mơ hồ, bạn sẽ cho ra một hướng đi, một trình tự và người chịu trách nhiệm từng phần, thường nhanh hơn mức người ta yêu cầu.',
      'Sự quyết đoán đó vừa là giá trị vừa là điểm mù của bạn. Bạn đi trước khi có đồng thuận, và đôi khi thứ bạn cán qua là một phản đối hợp lý mà bạn đã không chậm lại đủ để nghe.',
    ],
    strengths: [
      'Bạn biến mơ hồ thành kế hoạch người khác làm theo được',
      'Bạn ra quyết định mà người khác trì hoãn',
      'Bạn sẵn sàng chịu trách nhiệm cho kết quả',
      'Bạn tính trước vài nước mà không rời mắt khỏi nước hiện tại',
    ],
    growth: [
      'Nghe hết một phản đối được nói ra chậm chạp',
      'Nhận ra sự chắc chắn của bạn có thể khiến cả phòng im lặng',
      'Trân trọng một thứ đang chạy tốt dù không do bạn thiết kế',
    ],
    inRelationships:
      'Bạn thể hiện tình cảm bằng hành động: bạn sửa, bạn lo, bạn làm vấn đề biến mất. Thứ thường thiếu là phiên bản bạn ngồi cùng ai đó trong một vấn đề mà bạn không giải được.',
  },
  ENTP: {
    nickname: 'Nhà phát minh',
    tagline: 'Bạn cãi ngược lại vì muốn xem ý tưởng đó có sống sót nổi không.',
    overview: [
      'Bạn tư duy bằng cách thử. Đưa ra một khẳng định, phản xạ của bạn là đẩy vào nó xem chỗ nào vỡ, và bạn thấy việc đó thú vị hơn mức người khác tưởng.',
      'Điều này khiến bạn rất giỏi tìm ra lỗ hổng và kém đều đặn hơn trong việc dựng lại thứ thay thế. Phần thú vị của một vấn đề, với bạn, là phần trước khi nó biến thành công việc.',
    ],
    strengths: [
      'Bạn tìm ra lỗ hổng trong kế hoạch mà cả nhóm đã gật đầu cho qua',
      'Bạn thật sự thoải mái khi sai ngay trước mặt mọi người',
      'Bạn nghĩ ra nhiều phương án khi ai cũng kẹt ở một phương án',
      'Bạn nối một vấn đề với thứ gì đó ở lĩnh vực hoàn toàn khác',
    ],
    growth: [
      'Biết lúc nào cuộc tranh luận đã hết hữu ích',
      'Làm ra thứ đó, không chỉ lập luận cho nó',
      'Nhận ra khi nào phản biện là tò mò và khi nào chỉ là thói quen',
    ],
    inRelationships:
      'Bạn là người thú vị và làm người khác phải suy nghĩ. Điểm vướng lặp đi lặp lại là không phải câu nào cũng là lời mời tranh luận, và một người đang buồn thường muốn được lắng nghe hơn là được sửa lưng.',
  },
  ESFJ: {
    nickname: 'Người chăm lo',
    tagline:
      'Bạn nhớ ai không ăn được sữa, và bạn để ý người kia đã im lặng từ hai mươi phút trước.',
    overview: [
      'Bạn giữ cho phần đời sống thực tế của một nhóm không rời rạc. Bạn nhớ những chi tiết về con người khiến họ thấy mình được nhìn thấy, và bạn hành động theo đó mà không làm ầm lên.',
      'Vì sự hòa thuận quan trọng với bạn, xung đột hiện lên như thứ cần dập tắt hơn là thứ cần ngồi lại bên trong. Bản năng đó xử lý được rất nhiều va chạm nhỏ, và thỉnh thoảng chôn mất một bất đồng thật.',
    ],
    strengths: [
      'Bạn khiến người ta thật sự cảm thấy được chăm sóc',
      'Bạn làm đúng những gì đã nói sẽ làm',
      'Bạn để ý khi ai đó bỗng im lặng',
      'Bạn giữ được những thói quen và nếp sinh hoạt mà người khác để rơi',
    ],
    growth: [
      'Để một bất đồng mở đủ lâu để được giải quyết cho đúng',
      'Nói ra điều mình cần thay vì mong người ta tự nhận ra',
      'Tách bạch giữa "họ đang buồn" và "mình đã làm gì sai"',
    ],
    inRelationships:
      'Bạn vững vàng, ấm áp và luôn có mặt. Điều cần để ý là việc âm thầm ghi sổ: cho đi rất nhiều, không nói ra mình cần gì, rồi thấy mình không được nhìn thấy vì những lý do đối phương chưa từng có cơ hội nghe.',
  },
  ESFP: {
    nickname: 'Người trình diễn',
    tagline:
      'Bạn có mặt trọn vẹn trong căn phòng, và đó là lý do căn phòng dễ chịu hơn khi có bạn.',
    overview: [
      'Bạn sống ở hiện tại trọn vẹn hơn hầu hết mọi người làm được. Bạn cảm nhận được không khí, chất liệu, khoảnh khắc thật, và bạn kéo người khác vào đó cùng mình.',
      'Mặt còn lại là những thứ chỉ sinh lợi chậm và âm thầm thì hay bị bỏ quên. Kế hoạch dài hạn phải cạnh tranh với một hiện tại quá sống động, và hiện tại thường thắng.',
    ],
    strengths: [
      'Bạn khiến những khoảnh khắc bình thường thành đáng nhớ',
      'Bạn đọc không khí và thích ứng ngay lập tức',
      'Bạn thực tế trong khủng hoảng khi người khác còn đang choáng',
      'Bạn ấm áp một cách tự nhiên, không tính toán',
    ],
    growth: [
      'Ngồi lại với điều khó chịu thay vì đổi chủ đề',
      'Làm nốt phần buồn tẻ sau khi phần hào hứng kết thúc',
      'Chuẩn bị cho một tương lai còn chưa thấy rõ',
    ],
    inRelationships:
      'Bạn hào phóng, vui và hiện diện theo cách người ta nhớ mãi. Phần khó là việc duy trì không mấy hào nhoáng của một mối quan hệ dài, thứ đòi hỏi sự chú ý vào những ngày chẳng có gì xảy ra.',
  },
  ESTJ: {
    nickname: 'Người giám sát',
    tagline: 'Bạn đã nói sẽ lo, nên nó được lo xong.',
    overview: [
      'Bạn là lý do mọi thứ thật sự xong đúng ngày đã hẹn. Bạn dựng cấu trúc, bạn giữ người khác đúng với thỏa thuận, và bạn không thấy việc đó khó xử.',
      'Rủi ro của bạn là coi quy trình thành mục đích. Một quy định năm ngoái còn hiệu quả có thể đã hết tác dụng, và bạn dễ thi hành nó hơn là mở lại để xem xét.',
    ],
    strengths: [
      'Bạn giao đúng thứ đã cam kết, một cách đều đặn',
      'Bạn đưa trật tự vào những tình huống đang trôi dạt',
      'Bạn nói thẳng khi ai cũng đang vòng vo',
      'Bạn đáng tin tới mức người khác âm thầm dựa vào để lên kế hoạch',
    ],
    growth: [
      'Hỏi xem một quy định còn phục vụ mục đích ban đầu không',
      'Nghe hết một cách làm khác thường trước khi phán xét',
      'Nhận ra hiệu quả không phải thứ duy nhất đáng tối ưu',
    ],
    inRelationships:
      'Bạn trung thành và luôn có mặt, điều đó đáng giá hơn phần lớn những cử chỉ hoành tráng. Thứ dễ bị bỏ qua là đúng trong một cuộc tranh cãi không có nghĩa là đã giải quyết xong nó; đối phương vẫn cần thấy mình được nghe.',
  },
  ESTP: {
    nickname: 'Người quảng bá',
    tagline:
      'Bạn thà thử luôn cho biết còn hơn ngồi thêm một buổi họp nữa về nó.',
    overview: [
      'Bạn được hiệu chỉnh cho thời gian thực. Bạn đọc tình huống nhanh, hành động khi thông tin còn thiếu, và thường đúng đủ để ổn, một kỹ năng hiếm hơn người ta tưởng.',
      'Thiên hướng hành động đó khiến những việc chậm rãi và cân nhắc kỹ trở nên khó chịu. Bạn xuất sắc khi có chuyện xảy ra và bồn chồn khi chẳng có gì.',
    ],
    strengths: [
      'Bạn hành động dứt khoát khi người khác còn đang thu thập thông tin',
      'Bạn bình tĩnh và hữu dụng khi có sự cố',
      'Bạn đọc người nhanh và chính xác',
      'Bạn không sợ rủi ro khi rủi ro đó thật sự đáng',
    ],
    growth: [
      'Nghĩ xa hơn nước đi trước mắt tới nước kế tiếp',
      'Kiên nhẫn với một quy trình không thể đi tắt',
      'Nhận ra khi nào "dứt khoát" đã thành "thiếu kiên nhẫn"',
    ],
    inRelationships:
      'Bạn thú vị và làm mọi thứ chuyển động. Khó khăn lặp lại là chiều sâu theo thời gian: những cuộc trò chuyện quan trọng nhất trong một mối quan hệ dài đều là những cuộc chậm, và chậm là chế độ bạn khó ở lại nhất.',
  },
  INFJ: {
    nickname: 'Người cố vấn',
    tagline:
      'Bạn hiểu chuyện gì đang xảy ra với họ trước khi họ có từ để gọi tên, và bạn không nói gì.',
    overview: [
      'Bạn nhận ra những quy luật ở con người mà không phải lúc nào cũng giải thích được. Bạn thường biết chuyện sẽ đi tới đâu từ rất sớm, trước khi có bằng chứng, và bạn đúng đủ nhiều lần để khiến người khác thấy hơi rợn.',
      'Bạn cũng kín đáo hơn vẻ ngoài. Bạn khiến người khác mở lòng dễ dàng rồi trả lại một phiên bản đã chọn lọc của mình, nên bạn có thể được nhiều người biết mà rất ít người hiểu.',
    ],
    strengths: [
      'Bạn hiểu con người ở độ sâu mà họ hiếm khi gặp',
      'Bạn giữ vững niềm tin ngay cả khi phải trả giá',
      'Bạn nhìn thấy cả đường dài, không chỉ khoảnh khắc hiện tại',
      'Bạn cho lời khuyên mà người ta nhớ nhiều năm sau',
    ],
    growth: [
      'Để ai đó thấy phiên bản chưa qua chỉnh sửa của bạn',
      'Nói ra băn khoăn từ sớm thay vì lặng lẽ mang nó',
      'Nhận sự giúp đỡ mà không thấy như mình đã thất bại',
    ],
    inRelationships:
      'Bạn gắn bó sâu và chậm, và bạn cho đi sự thấu hiểu thật sự. Kiểu đổ vỡ đặc trưng là đóng sập cửa: âm thầm chịu đựng suốt nhiều tháng, rồi kết thúc theo cách mà với tất cả mọi người trừ bạn là quá đột ngột.',
  },
  INFP: {
    nickname: 'Người hòa giải',
    tagline:
      'Có một cách mà mọi thứ nên là, và bạn cảm nhận được chính xác phiên bản hiện tại còn cách nó bao xa.',
    overview: [
      'Bạn đối chiếu mọi thứ với một chuẩn bên trong về điều đúng đắn. Điều đó khiến bạn rất khó lay chuyển ở những chuyện quan trọng và dễ tính đến bất ngờ ở những chuyện không.',
      'Chính cái chuẩn đó cũng quay vào trong. Bạn đo mình theo một phiên bản chưa tồn tại, và bạn khắt khe với bản thân hơn hẳn với bất kỳ ai khác.',
    ],
    strengths: [
      'Bạn giữ những giá trị không bẻ cong dưới áp lực',
      'Bạn ngồi được cùng nỗi đau của người khác mà không vội sửa nó',
      'Bạn luôn nhìn thấy từng con người cụ thể, không phải nhóm',
      'Bạn nói ra được những điều người khác cảm thấy mà không diễn đạt nổi',
    ],
    growth: [
      'Để một thứ đủ tốt được tồn tại',
      'Gọi tên mâu thuẫn thay vì rút lui khỏi nó',
      'Dành cho mình sự kiên nhẫn mà bạn dành cho tất cả mọi người',
    ],
    inRelationships:
      'Bạn yêu hết lòng và để ý rất kỹ. Điểm vướng đến từ sự lý tưởng hóa: bạn có thể dựng nên một hình dung về ai đó, rồi âm thầm thấy bị phản bội khi người thật hóa ra chỉ là một con người.',
  },
  INTJ: {
    nickname: 'Kiến trúc sư',
    tagline: 'Bạn đã nghĩ xong chuyện này rồi và đang đợi mọi người bắt kịp.',
    overview: [
      'Bạn dựng mô hình. Bạn muốn hiểu một hệ thống thật sự vận hành thế nào, và khi đã hiểu thì những lỗi của nó hiện ra quá rõ và khó mà không thấy nữa.',
      'Sự tự tin vào lập luận của bạn phần lớn là xứng đáng, và đó chính là chỗ nguy hiểm. Bạn có thể gạt một phản đối chỉ vì người nói không lập luận giỏi, trong khi bản thân phản đối đó lại đúng.',
    ],
    strengths: [
      'Bạn thấy vấn đề mang tính cấu trúc từ rất lâu trước khi nó nổ ra',
      'Bạn thật sự độc lập trong suy nghĩ',
      'Bạn lên kế hoạch ở tầm xa mà đa số không nghĩ tới',
      'Bạn sẵn sàng bị ghét vì một điều bạn tin là đúng',
    ],
    growth: [
      'Xem xét nghiêm túc một phản đối được trình bày vụng về',
      'Giải thích lập luận thay vì chỉ đưa ra kết luận',
      'Chấp nhận rằng thông tin cảm xúc cũng là thông tin',
    ],
    inRelationships:
      'Bạn trung thành, thẳng thắn và coi trọng cam kết. Khoảng trống nằm ở biểu đạt: bạn có thể cảm nhận rất nhiều rồi mặc định người kia đã hiểu, trong khi họ cần được nghe điều đó bằng lời.',
  },
  INTP: {
    nickname: 'Nhà logic học',
    tagline: 'Bạn sẵn sàng dành ba tiếng cho một vấn đề chẳng ai nhờ bạn giải.',
    overview: [
      'Bạn muốn mọi thứ nhất quán từ bên trong. Một ý tưởng gần đúng làm bạn khó chịu hơn một ý tưởng sai rành rành, và bạn còn lật đi lật lại nó rất lâu sau khi cuộc trò chuyện đã đi tiếp.',
      'Khoảng cách nằm giữa hiểu và làm. Bạn có thể giữ trọn một lời giải trong đầu mà không thấy chút gấp gáp nào phải dựng nó lên, vì phần bạn muốn vốn là phần hiểu.',
    ],
    strengths: [
      'Bạn tìm ra lỗi lập luận mà tất cả đã chấp nhận',
      'Bạn thành thật về giới hạn hiểu biết của mình',
      'Bạn tiếp cận vấn đề không mang theo giả định có sẵn',
      'Bạn giải thích thứ phức tạp rất rõ khi bạn quyết định làm vậy',
    ],
    growth: [
      'Đưa ra thứ chưa hoàn hảo thay vì mài giũa nó một mình',
      'Nói ra suy nghĩ thay vì cho rằng nó đã hiển nhiên',
      'Coi cảm xúc của người khác là ràng buộc thật, không phải nhiễu',
    ],
    inRelationships:
      'Bạn thật lòng quan tâm cách một người suy nghĩ, và đó cũng là một dạng chú tâm. Khó khăn nằm ở dung lượng cảm xúc: bạn có thể im lặng đúng lúc ai đó cần bạn hiện diện, không phải vì không quan tâm mà vì đang xử lý.',
  },
  ISFJ: {
    nickname: 'Người nuôi dưỡng',
    tagline: 'Bạn đã lặng lẽ gánh chuyện này một thời gian rồi.',
    overview: [
      'Bạn chăm lo mọi thứ mà không cần ai nhờ và cũng không thông báo. Bạn nhớ điều gì quan trọng với từng người và hành động theo đó, đều đặn, qua nhiều năm.',
      'Vì bạn hiếm khi để phần đóng góp của mình hiện ra, nó thường không được thấy. Bạn có thể gánh nhiều hơn hẳn những gì người khác biết, kể cả bạn, cho tới lúc mọi thứ dồn lại một lần.',
    ],
    strengths: [
      'Bạn làm đến nơi đến chốn, mọi lần, không cần ai nhắc',
      'Bạn nhớ những chi tiết khiến người khác thấy mình được biết đến',
      'Bạn vững vàng khi hoàn cảnh thì không',
      'Bạn giúp bằng việc làm cụ thể chứ không phải lời an ủi',
    ],
    growth: [
      'Nói ra điều mình cần trước khi vượt quá sức chịu',
      'Để một thay đổi diễn ra mà không gồng lên chống lại',
      'Nhận giúp đỡ mà không coi đó là làm phiền người khác',
    ],
    inRelationships:
      'Bạn đáng tin tới mức trở thành nền móng cho người khác dựa vào. Cần để ý kiểu cho đi tới cạn kiệt rồi thấy mình không được trân trọng, vì một đóng góp mà chính bạn cố tình giữ cho vô hình.',
  },
  ISFP: {
    nickname: 'Người nghệ sĩ',
    tagline:
      'Bạn không giải thích nhiều, nhưng bạn biết chính xác mình muốn nó có cảm giác thế nào.',
    overview: [
      'Bạn có trực giác mạnh về cái đẹp và cái đúng, và hiếm khi tranh luận cho nó. Bạn đơn giản là biết điều gì hợp, rồi sắp xếp đời mình quanh đó thay vì quanh một quan điểm được tuyên bố.',
      'Bạn kín đáo hơn mức người ta đoán từ sự ấm áp của bạn. Xung đột làm bạn thật sự khó chịu, nên bạn thường lùi lại hơn là đẩy tới, và nhiều chuyện bị để không nói suốt một thời gian dài.',
    ],
    strengths: [
      'Bạn nhận ra vẻ đẹp và chi tiết mà người khác đi lướt qua',
      'Bạn chấp nhận con người đúng như họ là, không kèm điều kiện',
      'Bạn sống theo giá trị thay vì nói về giá trị',
      'Bạn ở lại cùng người đang khó khăn',
    ],
    growth: [
      'Nói ra một bất đồng khi nó còn nhỏ',
      'Lên kế hoạch đủ xa để điều bạn muốn có thể xảy ra',
      'Tin rằng gu thẩm mỹ của mình đáng được bảo vệ công khai',
    ],
    inRelationships:
      'Bạn tinh tế, bao dung và hiếm khi khiến ai thấy bị phán xét. Vấn đề lặp lại là tiếng nói: những điều làm bạn khó chịu có thể không được nói ra cho tới khi đã lớn tới mức khó mà bàn tới nữa.',
  },
  ISTJ: {
    nickname: 'Người thanh tra',
    tagline: 'Nếu bạn đã nói sẽ xong, thì nó xong, và xong đàng hoàng.',
    overview: [
      'Bạn là người mà mọi thứ có thể dựa vào. Bạn làm đúng điều đã nói, đúng chuẩn đã nói, đúng ngày đã nói, và bạn thấy lạ khi điều đó được coi là đáng khen.',
      'Bạn tin vào những gì đã được chứng minh. Sự hào hứng chưa qua kiểm chứng không lay chuyển được bạn, điều này giúp bạn tránh phần lớn ý tưởng tồi và thỉnh thoảng tránh mất một ý tưởng hay.',
    ],
    strengths: [
      'Lời bạn nói thật sự đáng tin',
      'Bạn bắt được lỗi mà mọi người đã lướt qua',
      'Bạn vững khi áp lực làm người khác chao đảo',
      'Bạn dựng những thứ trụ được với thời gian',
    ],
    growth: [
      'Cho một cách làm chưa được kiểm chứng một cơ hội thật',
      'Nói ra sự trân trọng mà bạn cho rằng người ta đã biết',
      'Để đủ tốt được coi là đã xong',
    ],
    inRelationships:
      'Bạn thể hiện tình cảm qua sự đều đặn và giữ lời, một dạng sâu sắc hơn phần lớn cử chỉ. Thứ thường thiếu là phần nói ra: những người thân nhất có thể cần nghe điều mà bạn cho là hiển nhiên.',
  },
  ISTP: {
    nickname: 'Người thợ lành nghề',
    tagline: 'Bạn tháo nó ra để xem nó chạy thế nào, và giờ nó chạy tốt hơn.',
    overview: [
      'Bạn hiểu mọi thứ bằng cách cầm vào nó. Lý thuyết cũng được, nhưng bạn học bằng cách làm, và bạn giỏi bất thường trong việc chẩn đoán thứ gì thật sự đang hỏng.',
      'Bạn cần quyền tự chủ nhiều hơn phần lớn mọi người và sẵn sàng đánh đổi nhiều để có nó. Bị quản lý sát sao không làm bạn làm tốt hơn, nó làm bạn bỏ đi.',
    ],
    strengths: [
      'Bạn sửa được những thứ người khác đã tuyên bố là hỏng',
      'Bạn hoàn toàn bình tĩnh trong tình huống khẩn cấp',
      'Bạn hiệu quả mà không cần ai bảo phải hiệu quả',
      'Bạn nói thẳng điều mình nghĩ, không tô vẽ',
    ],
    growth: [
      'Giải thích lập luận thay vì chỉ đưa ra kết quả',
      'Ở lại với một việc sau khi phần thú vị đã giải xong',
      'Nhận ra một mối quan hệ cần được duy trì chứ không chỉ được sửa',
    ],
    inRelationships:
      'Bạn dễ chịu khi ở cạnh và giúp đỡ theo cách cụ thể, hữu dụng. Điểm vướng là những cuộc trò chuyện cảm xúc: bạn thường hoặc giải quyết hoặc rút lui, trong khi có những chuyện không cần cả hai, chỉ cần bạn ở đó trong lúc nó khó khăn.',
  },
}
