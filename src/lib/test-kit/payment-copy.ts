import type { Locale } from '@/lib/i18n'

/**
 * The mechanical half of the checkout copy, shared by MBTI and IQ.
 *
 * `TestPaywall` renders one payment flow for both products, and most of what it says is
 * about a bank transfer rather than about a personality type or an IQ score: "scan this
 * QR", "account number", "send exactly this description". None of that differs per product,
 * and two copies of it would drift - the transfer warning in particular is load-bearing (a
 * transfer with the wrong memo cannot be matched), so a version of it that got softened in
 * one product only is a support problem.
 *
 * What stays in each product's own content file is the part that is genuinely about the
 * product: the paywall title, the pitch, what the email is for, and the delivery note.
 *
 * ```
 *   lib/test-kit/payment-copy.ts   how to pay          (shared)
 *   lib/mbti/content              what you are buying  (per product)
 *   lib/iq/content                what you are buying  (per product)
 * ```
 */

export type PaymentCopy = {
  payButton: string
  preparing: string
  scanTitle: string
  scanLead: string
  waiting: string
  done: string
  cancelled: string
  expiresIn: string
  expired: string
  retry: string
  transfer: {
    title: string
    bank: string
    accountNumber: string
    accountName: string
    amount: string
    transferNote: string
    transferWarning: string
    copy: string
    copied: string
  }
}

const PAYMENT_COPY: Record<Locale, PaymentCopy> = {
  vi: {
    payButton: 'Thanh toán',
    preparing: 'Đang tạo mã thanh toán...',
    scanTitle: 'Quét mã để thanh toán',
    scanLead: 'Mở app ngân hàng và quét mã QR bên dưới.',
    waiting: 'Đang chờ thanh toán...',
    done: 'Đã nhận thanh toán. Đang mở kết quả...',
    cancelled: 'Giao dịch đã hết hạn hoặc bị hủy. Vui lòng thử lại.',
    expiresIn: 'Mã thanh toán còn hiệu lực',
    expired: 'Mã thanh toán đã hết hạn.',
    retry: 'Tạo mã thanh toán mới',
    transfer: {
      title: 'Hoặc chuyển khoản thủ công',
      bank: 'Ngân hàng',
      accountNumber: 'Số tài khoản',
      accountName: 'Chủ tài khoản',
      amount: 'Số tiền',
      transferNote: 'Nội dung chuyển khoản',
      transferWarning:
        'Chuyển đúng nội dung ở trên, nếu không hệ thống không thể đối chiếu giao dịch của bạn.',
      copy: 'Sao chép',
      copied: 'Đã sao chép',
    },
  },
  en: {
    payButton: 'Pay',
    preparing: 'Creating your payment...',
    scanTitle: 'Scan to pay',
    scanLead: 'Open your banking app and scan the QR code below.',
    waiting: 'Waiting for your payment...',
    done: 'Payment received. Opening your result...',
    cancelled: 'That payment expired or was cancelled. Please try again.',
    expiresIn: 'Payment code valid for',
    expired: 'This payment code has expired.',
    retry: 'Create a new payment code',
    transfer: {
      title: 'Or transfer manually',
      bank: 'Bank',
      accountNumber: 'Account number',
      accountName: 'Account name',
      amount: 'Amount',
      transferNote: 'Transfer description',
      transferWarning:
        'Send exactly the description above, or the transfer cannot be matched to your result.',
      copy: 'Copy',
      copied: 'Copied',
    },
  },
}

export function paymentCopy(locale: Locale): PaymentCopy {
  return PAYMENT_COPY[locale]
}
