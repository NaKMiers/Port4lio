/**
 * Napas BIN to short bank name, for rendering PayOS transfer details on our own pages.
 * PayOS returns only the `bin`, never a display name.
 *
 * Deliberately partial: showing the WRONG bank name next to an account number is worse
 * than showing none, because someone might use it to sanity-check where their money is
 * going. `bankNameFromBin` returns `undefined` for anything unlisted and the UI omits that
 * row. In practice only the merchant's own bank ever appears here.
 */
export const BANK_NAMES: Record<string, string> = {
  '970403': 'Sacombank',
  '970405': 'Agribank',
  '970407': 'Techcombank',
  '970409': 'BacA Bank',
  '970412': 'PVcomBank',
  '970415': 'VietinBank',
  '970416': 'ACB',
  '970418': 'BIDV',
  '970422': 'MB Bank',
  '970423': 'TPBank',
  '970425': 'ABBank',
  '970426': 'MSB',
  '970428': 'Nam A Bank',
  '970429': 'SCB',
  '970431': 'Eximbank',
  '970432': 'VPBank',
  '970436': 'Vietcombank',
  '970437': 'HDBank',
  '970440': 'SeABank',
  '970441': 'VIB',
  '970443': 'SHB',
  '970448': 'OCB',
}

export function bankNameFromBin(bin?: string): string | undefined {
  if (!bin) return undefined

  return BANK_NAMES[bin]
}
