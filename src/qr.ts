// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * QR helpers for PHAR LAP: render text to a crisp inline-SVG QR code, and build a BSV payment URI.
 * Thin wrapper over the vendored Nayuki generator (qrcodegen.ts).
 */
import { qrcodegen } from './qrcodegen.ts'

const QrCode = qrcodegen.QrCode

/**
 * Build a BSV payment URI. Current BSV standard for an address payment request is BIP21
 * (`bitcoin:<address>?amount=<BSV>`, amount in whole BSV). With no amount, returns the plain address —
 * neutral and the most universally scannable (no `bitcoin:` scheme that could open a BTC wallet).
 * Isolated here so the scheme/format is a one-line change if the BSV standard ever shifts.
 */
export function bsvPaymentUri(address: string, amountSats?: number): string {
  if (amountSats == null || amountSats <= 0) return address
  const bsv = (amountSats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  return `bitcoin:${address}?amount=${bsv}`
}

/** Render `text` as a QR code, returned as an inline SVG string (dark modules on white, with a quiet zone). */
export function qrSvg(text: string, opts?: { border?: number; dark?: string; light?: string }): string {
  const border = opts?.border ?? 3
  const dark = opts?.dark ?? '#000000'
  const light = opts?.light ?? '#ffffff'
  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM)
  const dim = qr.size + border * 2
  let path = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) path += `${path ? ' ' : ''}M${x + border},${y + border}h1v1h-1z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
}
