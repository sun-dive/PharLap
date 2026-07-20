// © BSV Association — Licensed under the Open BSV License Version 5 (see LICENSE).
/**
 * PHAR LAP — browser wallet (single-page app).
 *
 * Wires the protocol modules (pushDrop / tokenCodec / collectionBuilder / transfer / verify)
 * to a minimal UI: wallet + balance, mint a collection, my tokens, send, check-incoming, verify.
 * Raw-key model: a WIF in localStorage; funding/broadcast/fetch via WoC (walletProvider);
 * verification via verifyTokenLineage. Tokens are tracked locally (PharLapStore) since PushDrop
 * outputs are not WoC-address-indexed.
 */
import { PrivateKey, PublicKey, Utils, Hash, LockingScript, Mnemonic, HD } from '@bsv/sdk'
import { WalletProvider } from './walletProvider.ts'
import { PharLapStore } from './pharlapStore.ts'
import { createCollection, getSafeUtxos, selectFunding, PHARLAP_OUTPUT_SATS, DEFAULT_FEE_PER_KB, SPEND_CANCELLED } from './collectionBuilder.ts'
import { createEdition, replicateEdition, transferEdition, burnEdition, toFundingInputs, scanIncomingEditions, resolveHolderEdition, replicateEditionV2, createGiftVouchers, scanGiftVouchers, scanVoucherHashes, sweepGiftVouchers, claimGiftEdition, scanCollectionBuyers, scanMySales, wocScriptHash, type EditionTerms, type EditionUtxo, type BuyerRecord, type MySales, type UnifiedSale } from './editionBuilder.ts'
import { buildAirgapRequest, buildAirgapPaymentRequest, signAirgapRequest, encodeAirgapRequest, decodeAirgapRequest, type AirgapAction, type AirgapRequest } from './airgap.ts'
import { sendPayment, gatherPaymentFunding, buildPaymentTx, assertValidAddress } from './payment.ts'
import { parseEditionAny, parseEditionScriptV2, editionSupportsBurn } from './covenant.ts'
import { createTransfer, scanIncoming } from './transfer.ts'
import { packAlbum, parseAlbum, isAlbum, ALBUM_MIME, MAX_ALBUM_TRACKS, type AlbumTrack } from './album.ts'
import { packManifest, parseManifest, isManifest, MANIFEST_MIME, type ManifestRef } from './refManifest.ts'
import { isBmf, parseBmf, fmtLrcTime } from './bmf.ts'
import { parseFlacPictures, parseFlacLyrics } from './flacMeta.ts'
import { parseId3Pictures, parseId3Lyrics } from './id3.ts'
import { parseLyrics, type ParsedLyrics } from './lyrics.ts'
import { resolveCue } from './sceneTimeline.ts'
import { sendMessage, scanIncomingMessages, type IncomingMessage } from './messageBuilder.ts'
import { publishSellerNote, resolveSellerNote, readNoteFromTx, noteHasContent, type SellerNote } from './sellerNote.ts'
import { publishPreview, resolvePreview, MAX_PREVIEW_BYTES } from './preview.ts'
import { publishBroadcast, resolveBroadcasts, type Broadcast } from './broadcast.ts'
import { qrSvg, bsvPaymentUri } from './qr.ts'
import type { Part } from './messageCodec.ts'
import type { StoredToken } from './pharlapStore.ts'
import { verifyTokenLineage, verifyEditionCovenant } from './verify.ts'
import { parseTemplateScript, parseFileScript, parseStorefrontScript, parseLegacyFileScript, decodeTokenRules, type TemplateFields, type StorefrontFields } from './tokenCodec.ts'
import { cachedThumb, thumbResolved, cacheNoThumb, makeThumb, cachedMime, cacheMime, downscaleToAvatar } from './thumbs.ts'
import { publishProfile, resolveProfile } from './profile.ts'
import { readCorridor, postToNodeFeed, type CorridorNode, type DiscPost } from './discussion.ts'
import { publishConfigBackup, resolveConfigBackup, mergeConfig } from './configBackup.ts'
import { unwrapContentKey, decryptContent } from './contentCrypto.ts'
import { decompress } from './compress.ts'

// Injected by build.mjs (esbuild define). Base version is manual; build id + date auto-update each build.
declare const __APP_VERSION__: string
declare const __BUILD_ID__: string
declare const __BUILD_DATE__: string

const WIF_KEY = 'p:wallet:wif'
const WATCH_KEY = 'p:wallet:watch' // present → watch-only: pubkey hex, no private key on this box

let key: PrivateKey | null // null in watch-only mode (the online box holds no key)
let pubKeyHex: string
let address: string
let provider: WalletProvider
let store: PharLapStore
let nftView: 'list' | 'grid' = 'list' // My-NFTs view mode (persisted in localStorage)
let nftSort: 'recent' | 'publisher' = 'recent' // My-NFTs grouping: by recency (then MIME) or by publisher
let lastInbox: IncomingMessage[] = [] // last scanned inbox, for re-render after saving an alias
let lastUpdatesFeed: UpdateItem[] | null = null // last updates feed, for re-render after saving an alias

// ─── small DOM helpers ──────────────────────────────────────────────
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}
const val = (id: string): string => ($(id) as HTMLInputElement).value.trim()
const short = (s: string, n = 10): string => (s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-n)}` : s)
const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)
/** Format a UTC epoch-ms timestamp in the viewer's OWN local timezone (the stored value is timezone-free). */
const fmtTime = (ms: number): string => { try { return new Date(ms).toLocaleString() } catch { return '' } }
/** Format a UTC epoch-ms timestamp as a fixed UTC string (same for every viewer) — e.g. on-chain provenance. */
const fmtUtc = (ms: number): string => { try { return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') } catch { return '' } }
function setStatus(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const el = $('status')
  el.textContent = msg
  el.className = `status ${kind}`
}
/** Like setStatus, but renders trusted HTML (only ever called with built-in markup + idChip — never raw input). */
function setStatusHtml(html: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const el = $('status')
  el.innerHTML = html
  el.className = `status ${kind}`
}
/** A click-to-copy chip: shows a shortened id, copies the FULL value on click (delegated handler below). */
function idChip(full: string): string {
  return `<span class="copyid" data-full="${escapeHtml(full)}" title="Click to copy the full id">${escapeHtml(short(full))}</span>`
}
// Delegated click-to-copy: clicking any shortened .copyid chip copies its full value to the clipboard.
document.addEventListener('click', e => {
  const chip = (e.target as HTMLElement)?.closest?.('.copyid') as HTMLElement | null
  if (chip?.dataset.full) { void navigator.clipboard?.writeText(chip.dataset.full); toast('Copied ✓') }
})

// ─── wallet ─────────────────────────────────────────────────────────
const MNEMONIC_KEY = 'p:wallet:mnemonic'
const BACKED_UP_KEY = 'p:wallet:backedUp' // set once the user confirms they've written the seed down
// Fixed BIP-44 path (236 = BSV coin type). MUST never change — restores derive the same key from it.
const DERIVATION_PATH = "m/44'/236'/0'/0/0"

/** Derive the wallet private key from a BIP-39 phrase (BIP-32 at the fixed path). Throws on an invalid phrase. */
function keyFromMnemonic(phrase: string, passphrase = ''): PrivateKey {
  const m = phrase.trim().replace(/\s+/g, ' ')
  if (!Mnemonic.isValid(m)) throw new Error('invalid seed phrase')
  return HD.fromSeed(Mnemonic.fromString(m).toSeed(passphrase)).derive(DERIVATION_PATH).privKey
}

/** Make a fresh seed wallet: a 12-word phrase + the key it derives. */
function newSeedWallet(): { mnemonic: string; key: PrivateKey } {
  const mnemonic = Mnemonic.fromRandom(128).toString() // 128 bits = 12 words
  return { mnemonic, key: keyFromMnemonic(mnemonic) }
}

function loadKey(): PrivateKey {
  const wif = localStorage.getItem(WIF_KEY)
  if (wif) {
    try { return PrivateKey.fromWif(wif) } catch { /* fall through to new */ }
  }
  // First run → a seed-phrase wallet (so new installs have a recoverable phrase), persisting both.
  const { mnemonic, key } = newSeedWallet()
  localStorage.setItem(WIF_KEY, key.toWif())
  localStorage.setItem(MNEMONIC_KEY, mnemonic)
  return key
}

function markBackedUp(): void { localStorage.setItem(BACKED_UP_KEY, '1') }
/** A fresh seed wallet the user hasn't confirmed backing up yet (WIF-only wallets have no seed → false). */
function needsSeedBackup(): boolean { return !!localStorage.getItem(MNEMONIC_KEY) && !localStorage.getItem(BACKED_UP_KEY) }

function useKey(k: PrivateKey): void {
  localStorage.removeItem(WATCH_KEY) // a real key supersedes any watch-only state
  key = k
  pubKeyHex = k.toPublicKey().toString()
  address = k.toAddress()
  provider = new WalletProvider(address)
  salesCache = null // the Sales scan belongs to the previous key
  renderWallet()
}

/** Load a WATCH-ONLY wallet: holdings/balance/exports/broadcast by public key alone — no private key on
 *  this box. Signing happens on the offline machine; here every signing action is blocked. */
function useWatchKey(watchPubKeyHex: string): void {
  const pub = PublicKey.fromString(watchPubKeyHex)
  key = null
  pubKeyHex = pub.toString()
  address = pub.toAddress()
  provider = new WalletProvider(address)
  salesCache = null
  renderWallet()
}

/** True when no private key is loaded (watch-only). */
function isWatchOnly(): boolean { return key == null }

/** Gate a signing action: returns the key, or null (after a status message) when watch-only. */
function requireKey(): PrivateKey | null {
  if (key == null) {
    setStatus('This is a watch-only wallet — it holds no private key. Export the request here, sign it on your offline machine, then broadcast the signed result.', 'error')
    return null
  }
  return key
}

/** Enter watch-only mode for `watchPubKeyHex`: wipe any local key, clear the (previous wallet's) holdings
 *  cache, and recover the watched wallet's holdings from chain. */
function switchToWatch(watchPubKeyHex: string): void {
  const pub = PublicKey.fromString(watchPubKeyHex) // throws on bad input → caller catches
  localStorage.setItem(WATCH_KEY, pub.toString())
  localStorage.removeItem(WIF_KEY)      // no private key lives on a watch-only box
  localStorage.removeItem(MNEMONIC_KEY)
  store.clear()
  useWatchKey(pub.toString())
  renderTokens()
  void refreshBalance()
  setStatus('Watch-only wallet loaded — recovering holdings from chain…')
  void onCheckIncoming()
}

/**
 * Switch the active wallet. The local token store is a CACHE belonging to the previous wallet, so clear it
 * and (on a WIF restore) rebuild this wallet's holdings from chain — the WIF + chain are the source of
 * truth, so purchases recover on any device. A fresh random wallet has nothing to recover.
 */
function switchWallet(k: PrivateKey, recover: boolean, mnemonic?: string): void {
  localStorage.setItem(WIF_KEY, k.toWif())
  // A seed-derived wallet keeps its phrase; a raw-WIF import has none, so clear any stale phrase.
  if (mnemonic != null && mnemonic !== '') localStorage.setItem(MNEMONIC_KEY, mnemonic)
  else localStorage.removeItem(MNEMONIC_KEY)
  store.clear()
  useKey(k)
  renderTokens()
  void refreshBalance()
  if (recover) {
    setStatus('Wallet restored — recovering your purchases from chain…')
    void onCheckIncoming()
    // Also pull your encrypted config backup (address book + alias + prefs) for this key, and merge it in.
    void restoreConfigFromChain(true).then(n => {
      if (n > 0) { renderContacts(); refreshNameSurfaces(); updateCfgBackupNote(); toast(`Restored ${n} contact${n > 1 ? 's' : ''} from your backup`) }
    }).catch(() => { /* best-effort */ })
  }
}

function renderWallet(): void {
  $('address').textContent = address
  $('pubkey').textContent = pubKeyHex
  const mine = document.getElementById('myIdenticon')
  if (mine) mine.innerHTML = avatarHtml(pubKeyHex, 22) // your own avatar (or identicon)
  document.body.classList.toggle('watch-only', key == null) // CSS hides key-only controls
  const watchEl = document.getElementById('watchBanner'); if (watchEl != null) watchEl.hidden = key != null
  ;($('wif') as HTMLInputElement).value = key != null ? key.toWif() : ''
  const seedEl = document.getElementById('seedPhrase') as HTMLTextAreaElement | null
  if (seedEl != null) seedEl.value = key != null ? (localStorage.getItem(MNEMONIC_KEY) ?? '') : '' // watch-only → no secret
  hideWif() // re-mask on every wallet (re)load so a switched-in key is never left exposed
  hideSeed()
}

/** Mask the WIF input and reset the toggle to "Show". */
function hideWif(): void {
  ;($('wif') as HTMLInputElement).type = 'password'
  $('btnWifShow').textContent = '👁 Show'
}

/** Seed phrase reveal is a CSS blur toggle (a textarea can't be type=password). Re-blur on every wallet load. */
function hideSeed(): void {
  const el = document.getElementById('seedPhrase'); const btn = document.getElementById('btnSeedShow')
  if (el != null) el.classList.add('blurred')
  if (btn != null) btn.textContent = '👁 Reveal'
}
function toggleSeed(): void {
  const el = document.getElementById('seedPhrase'); const btn = document.getElementById('btnSeedShow') as HTMLButtonElement | null
  if (el == null || btn == null) return
  const blurred = el.classList.toggle('blurred')
  btn.textContent = blurred ? '👁 Reveal' : '🙈 Hide'
}

/** Force the backup moment when a new seed wallet is created: show the 12 words, numbered, with a warning. */
function showSeedModal(mnemonic: string, opts: { gated?: boolean; intro?: string; onDone?: () => void } = {}): void {
  const words = mnemonic.split(' ')
  const overlay = document.createElement('div'); overlay.className = 'modal'
  const closeBtn = opts.gated ? '' : '<button class="secondary seed-close">✕ Close</button>'
  const intro = opts.intro ? `<p style="font-size:13px;margin:0 0 8px;color:#eab300;font-weight:600">${escapeHtml(opts.intro)}</p>` : ''
  const doneLabel = opts.gated ? '✅ I’ve written down my seed phrase — claim my NFT gift' : 'I’ve written it down'
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:460px">' +
    `<div class="modal-head"><span>🔑 Your new seed phrase</span>${closeBtn}</div>` +
    intro +
    '<p class="muted" style="font-size:13px;margin:0 0 10px">Write these 12 words down, in order, and keep them secret &amp; safe. <b>Anyone with them controls this wallet</b>, and if you lose them with no backup it <b>cannot be recovered</b>.</p>' +
    `<div class="seed-grid">${words.map((w, i) => `<div class="seed-word"><span class="seed-num">${i + 1}</span> ${escapeHtml(w)}</div>`).join('')}</div>` +
    `<div class="row" style="margin-top:12px"><button class="seed-copy">Copy phrase</button><button class="secondary seed-done">${doneLabel}</button></div>` +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.querySelector('.seed-close')?.addEventListener('click', close)
  overlay.querySelector('.seed-done')?.addEventListener('click', () => { markBackedUp(); close(); opts.onDone?.() })
  overlay.querySelector('.seed-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(mnemonic))
  document.body.append(overlay)
}

// ─── Buy BSV (on-ramp) + referral propagation ───────────────────────
// SimpleSwap referral (Orange Gateway shut down). The Buy-BSV button opens SimpleSwap (swap any crypto —
// incl. stablecoins USDT/USDC — for BSV) and tags a referral chosen by precedence: a share link's ?aff=… (publisher who shared
// the page wins) → your own saved ref-code (p:affRefCode) → who gifted you (persisted) → the app default.
// SimpleSwap has a TWO-TIER affiliate, so a referrer you brought in still earns you a cut — but the LINK only
// ever carries one winning code; the tiering is settled on SimpleSwap's side. Your own code rides on the links
// you share (withAff), closing the loop.
const SIMPLESWAP_BASE = 'https://simpleswap.io/'
// Default SimpleSwap ref-code, used when no other referral is present. This is sun-dive's AFFILIATE code (the
// exchange "?ref=" link from partners.simpleswap.io — NOT the customer refer-a-friend code DzckoPqltw, whose
// link forces a signup). Buy-BSV becomes simpleswap.io/?ref=<code>&from=btc-btc&to=bsv-bsv (BSV pre-selected).
const DEFAULT_REF_CODE = 'efe9f9694b4f'
let incomingAff: string | null = null // ref-code carried in on a share link opened this session

/** Pull a ref-code out of a SimpleSwap URL — either the exchange link (?ref=…) or the partner-signup link
 *  (customer-account/signup?referral=…) — or a bare code; null if none. */
function extractRefCode(input: string): string | null {
  const s = input.trim()
  if (s === '') return null
  const m = s.match(/[?&](?:ref|referral)=([^&\s]+)/i)
  if (m) return decodeURIComponent(m[1])
  if (/^[A-Za-z0-9_-]{3,}$/.test(s)) return s // a bare ref-code
  return null
}
function myRefCode(): string | null {
  try { return localStorage.getItem('p:affRefCode') } catch { return null }
}
/** Persisted ref-code of whoever GIFTED this wallet (set on a gift claim; rides in the config backup so it
 *  survives a wallet restore on a new device). Lets a gifter keep earning from a user they onboarded. */
function refByCode(): string | null {
  try { return localStorage.getItem('p:refBy') } catch { return null }
}
/** On a gift claim, remember the gifter's ref-code so their referral persists for this (often new) wallet. */
function rememberGifter(): void {
  if (incomingAff == null || incomingAff === '') return
  try { if (localStorage.getItem('p:refBy') == null) localStorage.setItem('p:refBy', incomingAff) } catch { /* ignore */ }
}
/** The Buy-BSV (SimpleSwap) URL for the active context. Precedence: a share link's aff (current page) → your
 *  own saved code → who gifted you (persisted) → app default. `||` so an empty code falls through cleanly.
 *  Pre-selects a BTC → BSV swap of ~0.001 BTC (a sane default ≈ $60 of BSV; SimpleSwap's own default is a
 *  wild 0.1 BTC). The buyer can still change the source coin and the amount. */
function buyBsvUrl(): string {
  const code = incomingAff || myRefCode() || refByCode() || DEFAULT_REF_CODE
  const ref = code ? 'ref=' + encodeURIComponent(code) + '&' : ''
  return SIMPLESWAP_BASE + '?' + ref + 'from=btc-btc&to=bsv-bsv&amount=0.001'
}
function onBuyBsv(): void { window.open(buyBsvUrl(), '_blank', 'noopener,noreferrer') }

/** Append your referral code to a share URL so buyers who open it fund up under YOUR ref-code. */
function withAff(url: string): string {
  const code = myRefCode()
  return code != null && code !== '' ? `${url}&aff=${encodeURIComponent(code)}` : url
}

/** A shareable collection link. The collection id goes in the PATH (/c/<txid>) so link-preview crawlers
 *  see it (share.php renders per-NFT Open Graph from that); the holder + gift voucher stay in the #hash —
 *  client-only, so the voucher key is never sent to the server. share.php redirects real visitors to the
 *  app's `#c=…` route, so the app itself is unchanged. */
function collectionShareUrl(txid: string, holder: string, giftWif?: string): string {
  const params = new URLSearchParams({ h: holder })
  if (giftWif) params.set('g', giftWif)
  return withAff(`${location.origin}/c/${txid}#${params.toString()}`)
}

/** Shorten a share link via the server: registers {txid, holder, referral} (PUBLIC only — never the
 *  voucher) and returns `${origin}/s/<code>` for the caller to append a gift voucher to as a #hash, or
 *  null if the server is unreachable (callers fall back to the full /c/<txid> link, which still works
 *  and still previews). The referral is folded into the code, so it drops out of the visible link. */
async function shortShareBase(txid: string, holder: string): Promise<string | null> {
  try {
    const r = await fetch('/shorten.php', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txid, holder, aff: myRefCode() ?? undefined }),
    })
    const data = await r.json().catch(() => null)
    if (r.ok && data != null && typeof data.code === 'string' && data.code) return `${location.origin}/s/${data.code}`
  } catch { /* fall back to the full link */ }
  return null
}

/** Re-encode a cover image to a JPEG data URL (crawler-friendly; some don't render WebP) via canvas. */
function coverToJpegDataUrl(cover: { mimeType: string; bytes: number[] }): Promise<string | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(cover.bytes)], { type: cover.mimeType }))
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
        const ctx = c.getContext('2d')
        if (ctx == null) { resolve(null); return }
        ctx.drawImage(img, 0, 0)
        resolve(c.toDataURL('image/jpeg', 0.85))
      } catch { resolve(null) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/** Push a collection's PUBLIC preview assets (cover + title + description) to the server cache so shared
 *  links get a rich per-NFT preview. Idempotent + fire-and-forget — failure just falls back to the default
 *  banner. NEVER sends the gift voucher (public data only). */
const ogRegistered = new Set<string>()
async function registerOgAssets(info: CollectionInfo): Promise<void> {
  if (ogRegistered.has(info.tx1Ref)) return
  ogRegistered.add(info.tx1Ref)
  try {
    const cover = info.cover ? await coverToJpegDataUrl(info.cover) : null
    await fetch('/register.php', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txid: info.tx1Ref, title: info.name, description: info.description, cover: cover ?? undefined }),
    })
  } catch { ogRegistered.delete(info.tx1Ref) /* allow a later retry */ }
}

/** Show the saved referral code in its field (called on load). */
function renderAffField(): void {
  const el = document.getElementById('affRefCode') as HTMLInputElement | null
  if (el != null) el.value = myRefCode() ?? ''
}
/** Save (or clear) the user's SimpleSwap referral code from the settings field. */
function onSaveAff(): void {
  const raw = val('affRefCode')
  if (raw === '') {
    try { localStorage.removeItem('p:affRefCode') } catch { /* ignore */ }
    setStatus('Referral code cleared — your shared links use the app default.', 'ok'); return
  }
  const code = extractRefCode(raw)
  if (code == null) { setStatus('That doesn’t look like a SimpleSwap link or ref-code.', 'error'); return }
  try { localStorage.setItem('p:affRefCode', code) } catch { /* ignore */ }
  ;($('affRefCode') as HTMLInputElement).value = code
  setStatus('Saved — your shared sales pages now carry your Buy-BSV referral.', 'ok')
}

// ─── QR scanning (camera) ───────────────────────────────────────────
// Opens the camera in a modal and resolves with the first QR's text (or null if cancelled / no camera). Uses
// the native BarcodeDetector where available (Chromium/Android, zero cost); on browsers without it (iOS Safari,
// Firefox) it LAZY-LOADS a vendored jsQR (./jsqr.min.js) on first use, so the core bundle isn't bloated.
type QrDecode = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: string }) => { data: string } | null
let jsqrFn: QrDecode | null = null
async function loadJsqr(): Promise<QrDecode | null> {
  if (jsqrFn != null) return jsqrFn
  try {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = './jsqr.min.js'; s.async = true
      s.onload = () => resolve(); s.onerror = () => reject(new Error('load failed'))
      document.head.append(s)
    })
    const g = (window as unknown as { jsQRlib?: QrDecode & { default?: QrDecode } }).jsQRlib
    jsqrFn = g?.default ?? g ?? null
  } catch { jsqrFn = null }
  return jsqrFn
}

async function scanQrModal(title: string): Promise<string | null> {
  if (navigator.mediaDevices?.getUserMedia == null) {
    setStatus('This browser can’t access a camera (needs HTTPS + camera support).', 'error'); return null
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  } catch {
    setStatus('Camera unavailable — allow camera access (and use HTTPS) to scan.', 'error'); return null
  }
  const overlay = document.createElement('div'); overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:380px">' +
    `<div class="modal-head"><span>${escapeHtml(title)}</span><button class="secondary scan-close">✕ Close</button></div>` +
    '<video class="qr-scan-video" playsinline muted></video>' +
    '<p class="muted" style="font-size:12px;margin:8px 0 0">Point the camera at a QR code.</p></div>'
  document.body.append(overlay)
  const video = overlay.querySelector('video') as HTMLVideoElement
  video.srcObject = stream
  await video.play().catch(() => { /* autoplay quirks — the frame loop still reads it */ })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
  const detector = Detector != null ? new Detector({ formats: ['qr_code'] }) : null
  // No native detector (iOS Safari / Firefox) → lazy-load the vendored jsQR now (one-time ~46 KB fetch).
  let decode: QrDecode | null = null
  if (detector == null) {
    decode = await loadJsqr()
    if (decode == null) {
      stream.getTracks().forEach(t => t.stop()); overlay.remove()
      setStatus('Couldn’t load the QR scanner — check your connection and retry.', 'error'); return null
    }
  }

  return new Promise<string | null>(resolve => {
    let done = false
    const finish = (val: string | null): void => {
      if (done) return; done = true
      stream.getTracks().forEach(t => t.stop())
      overlay.remove(); resolve(val)
    }
    overlay.querySelector('.scan-close')?.addEventListener('click', () => finish(null))
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null) })
    const tick = async (): Promise<void> => {
      if (done) return
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        try {
          if (detector != null) {
            const codes = await detector.detect(canvas)
            if (codes.length > 0 && codes[0].rawValue) { finish(codes[0].rawValue); return }
          } else {
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const r = decode!(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (r?.data) { finish(r.data); return }
          }
        } catch { /* transient decode error — keep scanning */ }
      }
      requestAnimationFrame(() => void tick())
    }
    requestAnimationFrame(() => void tick())
  })
}

/** Normalize a scanned string for the target field (strip a payment URI scheme; pull a pubkey from a share link). */
function normalizeScan(kind: string | undefined, text: string): string {
  let s = text.trim()
  if (kind === 'addr') s = s.replace(/^(bitcoin|bitcoinsv|bsv):/i, '').split('?')[0].trim()
  else if (kind === 'pubkey') { const m = s.match(/[?&#]h=([0-9a-fA-F]{66,130})/); if (m) s = m[1] }
  return s
}

/** Scan a QR into an input field, then fire `input` so any live preview updates. */
async function onScanInto(input: HTMLInputElement, kind: string | undefined): Promise<void> {
  const text = await scanQrModal('📷 Scan QR code')
  if (text == null) return
  input.value = normalizeScan(kind, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  setStatus('Scanned ✓', 'ok')
}

/** Inject a 📷 button beside every `input[data-scan]`, wrapping the pair in a flex row. */
function wireScanButtons(): void {
  document.querySelectorAll<HTMLInputElement>('input[data-scan]').forEach(input => {
    if (input.dataset.scanWired === '1') return
    input.dataset.scanWired = '1'
    const btn = document.createElement('button')
    btn.type = 'button'; btn.className = 'secondary scan-btn'; btn.textContent = '📷'; btn.title = 'Scan a QR code'
    const wrap = document.createElement('div'); wrap.className = 'scan-row'
    input.parentNode?.insertBefore(wrap, input)
    wrap.append(input, btn)
    btn.onclick = () => void onScanInto(input, input.dataset.scan)
  })
}

async function refreshBalance(): Promise<void> {
  setStatus('Fetching balance…')
  try {
    const safe = await getSafeUtxos(provider)
    const spendable = safe.reduce((s, u) => s + u.satoshis, 0)
    $('balance').textContent = `${spendable} sats spendable (${safe.length} funding UTXO${safe.length === 1 ? '' : 's'})`
    setStatus('Balance updated.', 'ok')
  } catch (e) {
    setStatus(`Balance error: ${(e as Error).message}`, 'error')
  }
}

// ─── mint ───────────────────────────────────────────────────────────
async function readFile(input: HTMLInputElement): Promise<{ mimeType: string; fileName: string; bytes: number[] } | undefined> {
  const f = input.files?.[0]
  if (!f) return undefined
  const buf = new Uint8Array(await f.arrayBuffer())
  return { mimeType: f.type || 'application/octet-stream', fileName: f.name, bytes: Array.from(buf) }
}

/** Read a content input: ONE file → that file; MULTIPLE → packed into a single PharLap album container
 *  (one blob to the chain — covenant/provenance unchanged). Tracks are ordered by filename, so numbering
 *  them 01.., 02.. controls the order. The whole release is hash-committed + timestamped as one unit. */
async function readContent(input: HTMLInputElement, albumName: string): Promise<{ mimeType: string; fileName: string; bytes: number[] } | undefined> {
  const fs = input.files
  if (!fs || fs.length === 0) return undefined
  if (fs.length === 1) return readFile(input)
  if (fs.length > MAX_ALBUM_TRACKS) throw new Error(`Select at most ${MAX_ALBUM_TRACKS} tracks for one release (got ${fs.length}).`)
  const ordered = Array.from(fs).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const tracks: AlbumTrack[] = []
  for (const f of ordered) tracks.push({ name: f.name, mimeType: f.type || 'application/octet-stream', bytes: Array.from(new Uint8Array(await f.arrayBuffer())) })
  const safe = (albumName || 'album').replace(/[^\w.-]+/g, '_')
  return { mimeType: ALBUM_MIME, fileName: `${safe}.plep`, bytes: packAlbum(tracks) }
}

/** Non-blocking heads-up before embedding large or lossless audio on-chain (it's permanent and the fee
 *  scales with size). A WARNING, not a gate — returns true to proceed (always an option, for max-fidelity
 *  masters), false only if the user explicitly cancels. Silent when there's nothing to flag. */
function confirmAudioFidelity(file: { mimeType: string; fileName: string; bytes: number[] }): boolean {
  const isLossless = (mime: string, name: string): boolean =>
    /wav|aiff|x-aiff|flac|x-flac|x-pn-wav/.test(mime.toLowerCase()) || /\.(wav|aif|aiff|flac|alac)$/i.test(name)
  let lossless = false
  if (file.mimeType === ALBUM_MIME) {
    for (const t of parseAlbum(file.bytes) ?? []) if (isLossless(t.mimeType, t.name)) { lossless = true; break }
  } else {
    lossless = isLossless(file.mimeType, file.fileName)
  }
  const big = file.bytes.length > 8 * 1024 * 1024 // 8 MB
  if (!lossless && !big) return true
  const advice = lossless
    ? 'Compressing to MP3/Opus first can cut the cost dramatically — but if you want maximum fidelity, keeping it lossless is totally fine.'
    : 'Compressing it first can cut the cost — but if you need the full file, that’s fine.'
  return confirm(
    `Heads up — you’re embedding ${lossless ? 'uncompressed / lossless audio' : 'a large file'} (${kb(file.bytes.length)}).\n\n` +
    `It’s stored permanently on-chain, so the mint fee scales with its size. ${advice}\n\nMint as-is?`)
}

async function onMint(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const name = val('mintName')
  const count = Math.max(1, parseInt(val('mintCount') || '1', 10))
  if (!name) { setStatus('Enter a collection name.', 'error'); return }
  setStatus('Preparing the mint transaction…')
  try {
    const file = await readContent($('mintFile') as HTMLInputElement, name)
    if (file != null && !confirmAudioFidelity(file)) { setStatus('Mint cancelled — compress the file first, or proceed as-is when you’re ready.'); return }
    const result = await createCollection(provider, k, {
      tokenName: name, supply: count, mintCount: count, file,
      confirmSpend: total => confirm(
        `Mint ${count} NFT${count > 1 ? 's' : ''} in “${name}”${file ? ` (embedding a ${kb(file.bytes.length)} file)` : ''}?\n\n` +
        `This spends ${total.toLocaleString()} sats from your wallet (network fee + ${count} × 1-sat token output${count > 1 ? 's' : ''}).\n\n` +
        `Proceed?`),
    })
    for (const op of result.tokenOutpoints) {
      store.add({ txId: op.txId, outputIndex: op.outputIndex, collectionId: result.collectionId, stateData: '', collectionName: name })
    }
    renderTokens()
    setStatusHtml(`Minted ${result.tokenOutpoints.length} NFT(s). Collection ${idChip(result.collectionId)} (TX1 ${idChip(result.tx1Id)}, TX2 ${idChip(result.tx2Id)}).`, 'ok')
  } catch (e) {
    if ((e as Error).message === SPEND_CANCELLED) { setStatus('Mint cancelled — nothing was spent.'); return }
    setStatus(`Mint failed: ${(e as Error).message}`, 'error')
  }
}

// ─── editions (experimental covenant) ──────────────────────────────
/** Default refundable bond (sats) each edition rides on; the publisher overrides it per collection at mint. */
const EDITION_BOND_SATS = 2100

/** Readable price: large amounts as BSV (0.485 BSV / 1.25 BSV, ≥ 0.01 BSV), small ones as whole sats. */
function fmtPrice (sats: number): string {
  const s = Math.round(Number(sats) || 0)
  return s >= 1_000_000 ? (s / 1e8).toFixed(3).replace(/\.?0+$/, '') + ' BSV' : s.toLocaleString() + ' sats'
}

/** The bond chosen in the mint form (≥ 1 sat dust floor). */
function chosenBond(): number {
  return Math.max(1, parseInt(val('edBond') || String(EDITION_BOND_SATS), 10))
}

let feeMode: 'fixed' | 'pct' = 'fixed' // Publish pricing input mode (both mint plain v1 fixed fees)

/** Resolve the fixed (publisher, holder) fees from the active Publish pricing mode. Percentage mode is a
 *  calculator: the fee pot = final price − bond; the reseller (holder) keeps its net share, publisher the
 *  rest. Both floored at 1 sat (a 0-sat fee is dust + leaves no sale signal). Minted as plain v1 fixed-fee. */
function computeFees(): { publisherFeeSats: number; holderFeeSats: number } {
  if (feeMode === 'pct') {
    const bond = chosenBond()
    const fees = Math.max(2, (parseInt(val('edPrice') || '0', 10) || 0) - bond) // ≥2 so each fee ≥1
    const resellerPct = Math.min(100, Math.max(0, parseInt(val('edResellerPct') || '0', 10) || 0))
    const holderFeeSats = Math.min(fees - 1, Math.max(1, Math.round(fees * resellerPct / 100)))
    return { publisherFeeSats: Math.max(1, fees - holderFeeSats), holderFeeSats }
  }
  return {
    publisherFeeSats: Math.max(1, parseInt(val('edPublisherFee') || '1', 10)),
    holderFeeSats: Math.max(1, parseInt(val('edHolderFee') || '1', 10)),
  }
}

function ownTerms(): EditionTerms {
  return {
    publisherPubKeyHash: Hash.hash160(Utils.toArray(pubKeyHex, 'hex')),
    ...computeFees(),
    tokenSats: chosenBond(),
  }
}

/** Toggle the Publish pricing input mode + refresh the percentage preview. */
function setFeeMode(mode: 'fixed' | 'pct'): void {
  feeMode = mode
  $('btnFeeFixed').classList.toggle('active', mode === 'fixed')
  $('btnFeePct').classList.toggle('active', mode === 'pct')
  $('feeFixed').hidden = mode !== 'fixed'
  $('feePct').hidden = mode !== 'pct'
  updateFeePctPreview()
}

function updateFeePctPreview(): void {
  if (feeMode !== 'pct') return
  const bond = chosenBond()
  const enteredPrice = parseInt(val('edPrice') || '0', 10) || 0
  const el = $('edPctPreview')
  if (enteredPrice < bond + 2) { // price must clear the bond with room for both fees
    el.innerHTML = `<span style="color:#ffb4ae">Final price must be at least ${(bond + 2).toLocaleString()} sat (above the ${bond.toLocaleString()}-sat bond).</span>`
    return
  }
  const f = computeFees()
  const buyerTotal = f.publisherFeeSats + f.holderFeeSats + bond
  el.innerHTML =
    `→ Reseller <b>${f.holderFeeSats.toLocaleString()}</b> · Publisher <b>${f.publisherFeeSats.toLocaleString()}</b> · bond <b>${bond.toLocaleString()}</b> (refundable)` +
    `<br>Buyer pays <b>${buyerTotal.toLocaleString()} sat</b> per copy <span class="muted">(+ a small network fee; the ${bond.toLocaleString()}-sat bond is reclaimable by burning)</span>`
}

function termsFromToken(t: StoredToken): EditionTerms {
  return {
    publisherPubKeyHash: Utils.toArray(t.publisherPubKeyHashHex ?? '', 'hex'),
    publisherFeeSats: t.publisherFeeSats ?? 0,
    holderFeeSats: t.holderFeeSats ?? 0,
    tokenSats: t.tokenSats ?? 1,
  }
}

function storeEdition(o: { txId: string; outputIndex: number; lockHex: string }, collectionId: string, name: string, terms: EditionTerms, note?: SellerNote | null): void {
  store.add({
    txId: o.txId, outputIndex: o.outputIndex, collectionId, stateData: '', collectionName: name,
    kind: 'edition', lockHex: o.lockHex, publisherPubKeyHashHex: Utils.toHex(terms.publisherPubKeyHash),
    publisherFeeSats: terms.publisherFeeSats, holderFeeSats: terms.holderFeeSats,
    ...(terms.tokenSats != null ? { tokenSats: terms.tokenSats } : {}),
    ...(note?.text ? { sellerNote: note.text } : {}),
    ...(note?.bonusValue ? { bonusKind: note.bonusKind, bonusValue: note.bonusValue } : {}),
  })
}

// ── Cover crop + resize: a square 800×800 WebP (JPEG fallback) so on-chain covers stay small + uniform ──
const COVER_OUT = 800
let croppedCover: { mimeType: string; fileName: string; bytes: number[] } | null = null
let coverPrevUrl: string | null = null

function paintCoverPreview(blob: Blob | null): void {
  const host = $('edCoverPreview'); if (!host) return
  if (coverPrevUrl) { URL.revokeObjectURL(coverPrevUrl); coverPrevUrl = null }
  if (!blob) { host.innerHTML = ''; return }
  coverPrevUrl = URL.createObjectURL(blob)
  host.innerHTML = `<img src="${coverPrevUrl}" alt="cover" /><span class="muted" style="font-size:12px">Cover — ${kb(blob.size)}</span>`
}

/** True for an animated WebP (has an ANIM chunk) or a GIF — running these through the crop canvas would
 *  flatten them to a single static frame, so we offer to keep them as-is instead. */
async function isAnimatedImage(f: File): Promise<boolean> {
  if (f.type === 'image/gif' || /\.gif$/i.test(f.name)) return true
  if (f.type === 'image/webp' || /\.webp$/i.test(f.name)) {
    try { const s = String.fromCharCode(...new Uint8Array(await f.slice(0, 4096).arrayBuffer())); return s.includes('ANIM') || s.includes('ANMF') } catch { return false }
  }
  return false
}

/** Crop a chosen image (file or photo) and store the processed cover bytes. Returns false if cancelled.
 *  An animated WebP/GIF is offered as a pass-through (keeps the loop) rather than being flattened by the crop. */
async function cropAndStoreCover(f: File): Promise<boolean> {
  if (await isAnimatedImage(f)) {
    if (confirm(`"${f.name}" is animated (${kb(f.size)}). Keep it animated as the cover?\n\nOK — keep the animation as-is (it rides on-chain, so a larger animated cover costs a little more to mint).\nCancel — crop it to a small, static 800×800 cover instead.`)) {
      const bytes = Array.from(new Uint8Array(await f.arrayBuffer()))
      croppedCover = { mimeType: f.type || 'image/webp', fileName: f.name || 'cover.webp', bytes }
      paintCoverPreview(new Blob([new Uint8Array(bytes)], { type: croppedCover.mimeType }))
      return true
    }
  }
  const blob = await openCropModal(f)
  if (!blob) return false
  croppedCover = { mimeType: blob.type || 'image/webp', fileName: 'cover.webp', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
  paintCoverPreview(blob)
  return true
}

/** Cover file picked from disk → crop + store (clear the input if the crop is cancelled). */
async function onCoverSelected(): Promise<void> {
  const input = $('edCover') as HTMLInputElement
  const f = input.files?.[0]
  if (!f) { croppedCover = null; paintCoverPreview(null); return }
  if (!(await cropAndStoreCover(f))) input.value = ''
}

/** "Take photo" → open the camera, capture a frame, then run it through the same crop flow. */
async function onTakePhoto(): Promise<void> {
  const photo = await capturePhotoModal()
  if (!photo) return
  ;($('edCover') as HTMLInputElement).value = '' // a captured photo supersedes any file selection
  await cropAndStoreCover(photo)
}

/** Open the device camera in a modal; resolve a captured still as a File, or null if cancelled. */
async function capturePhotoModal(): Promise<File | null> {
  if (navigator.mediaDevices?.getUserMedia == null) {
    setStatus('This browser can’t access a camera (needs HTTPS + camera support).', 'error'); return null
  }
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }) }
  catch { setStatus('Camera unavailable — allow camera access (and use HTTPS) to take a photo.', 'error'); return null }
  const overlay = document.createElement('div'); overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:380px">' +
    '<div class="modal-head"><span>📷 Take a cover photo</span><button class="secondary cam-close">✕ Cancel</button></div>' +
    '<video class="qr-scan-video" playsinline muted></video>' +
    '<div class="row" style="justify-content:center;margin-top:10px"><button class="cam-shot">📸 Capture</button></div></div>'
  document.body.append(overlay)
  const video = overlay.querySelector('video') as HTMLVideoElement
  video.srcObject = stream
  await video.play().catch(() => { /* autoplay quirks — the still capture still works */ })

  return new Promise<File | null>(resolve => {
    let done = false
    const finish = (file: File | null): void => {
      if (done) return; done = true
      stream.getTracks().forEach(t => t.stop()); overlay.remove(); resolve(file)
    }
    overlay.querySelector('.cam-close')!.addEventListener('click', () => finish(null))
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null) })
    overlay.querySelector('.cam-shot')!.addEventListener('click', () => {
      const w = video.videoWidth, h = video.videoHeight
      if (!w || !h) { setStatus('Camera not ready yet — try again.', 'error'); return }
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(video, 0, 0, w, h)
      c.toBlob(b => finish(b ? new File([b], 'photo.jpg', { type: b.type || 'image/jpeg' }) : null), 'image/jpeg', 0.92)
    })
  })
}

/** Interactive square crop + downscale → WebP (JPEG fallback). Resolves the Blob, or null if cancelled. */
function openCropModal(file: File): Promise<Blob | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('Could not read that image.', 'error'); resolve(null) }
    img.onload = () => {
      const VIEW = 300
      const overlay = document.createElement('div'); overlay.className = 'modal'
      overlay.innerHTML =
        '<div class="modal-box" style="max-width:360px">' +
        '<div class="modal-head"><span>✂️ Position your cover</span><button class="secondary crop-cancel">✕ Cancel</button></div>' +
        `<canvas class="crop-canvas" width="${VIEW}" height="${VIEW}"></canvas>` +
        '<label style="margin-top:10px">Zoom</label>' +
        '<input type="range" class="crop-zoom" min="1" max="4" step="0.01" value="1" style="width:100%" />' +
        `<p class="muted" style="font-size:11px;margin:6px 0 12px">Drag to position, slide to zoom. Saved as a ${COVER_OUT}×${COVER_OUT} WebP — small for on-chain storage.</p>` +
        '<div class="row" style="justify-content:flex-end;gap:8px"><button class="secondary crop-cancel2">Cancel</button><button class="crop-use">Use this crop</button></div>' +
        '</div>'
      document.body.appendChild(overlay)
      const canvas = overlay.querySelector('.crop-canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const zoom = overlay.querySelector('.crop-zoom') as HTMLInputElement

      const base = Math.max(VIEW / img.width, VIEW / img.height) // zoom=1 just covers the square
      let z = 1, ox = 0, oy = 0
      const dims = () => ({ w: img.width * base * z, h: img.height * base * z })
      const clamp = () => { const { w, h } = dims(); ox = Math.min(0, Math.max(VIEW - w, ox)); oy = Math.min(0, Math.max(VIEW - h, oy)) }
      const draw = () => { const { w, h } = dims(); ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, VIEW, VIEW); ctx.drawImage(img, ox, oy, w, h) }
      { const { w, h } = dims(); ox = (VIEW - w) / 2; oy = (VIEW - h) / 2 } // start centered
      draw()

      let drag = false, lx = 0, ly = 0
      canvas.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing') })
      canvas.addEventListener('pointermove', e => {
        if (!drag) return
        const k = canvas.width / (canvas.clientWidth || canvas.width) // CSS px → buffer px (canvas may display smaller)
        ox += (e.clientX - lx) * k; oy += (e.clientY - ly) * k; lx = e.clientX; ly = e.clientY; clamp(); draw()
      })
      const endDrag = (): void => { drag = false; canvas.classList.remove('grabbing') }
      canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag)
      zoom.addEventListener('input', () => {
        const nz = parseFloat(zoom.value); const r = nz / z; const c = VIEW / 2
        ox = c - (c - ox) * r; oy = c - (c - oy) * r; z = nz; clamp(); draw()
      })

      const close = (b: Blob | null): void => { URL.revokeObjectURL(url); overlay.remove(); resolve(b) }
      overlay.querySelector('.crop-cancel')!.addEventListener('click', () => close(null))
      overlay.querySelector('.crop-cancel2')!.addEventListener('click', () => close(null))
      overlay.querySelector('.crop-use')!.addEventListener('click', () => {
        const s = base * z, sx = -ox / s, sy = -oy / s, sSize = VIEW / s
        const out = document.createElement('canvas'); out.width = COVER_OUT; out.height = COVER_OUT
        out.getContext('2d')!.drawImage(img, sx, sy, sSize, sSize, 0, 0, COVER_OUT, COVER_OUT)
        out.toBlob(b => { if (b && b.type === 'image/webp') close(b); else out.toBlob(j => close(j), 'image/jpeg', 0.85) }, 'image/webp', 0.8)
      })
    }
    img.src = url
  })
}

async function onMintEdition(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const name = val('edName')
  if (!name) { setStatus('Enter an edition collection name.', 'error'); return }
  const count = Math.max(1, parseInt(val('edCount') || '1', 10))
  const encrypt = ($('edEncrypt') as HTMLInputElement).checked
  const description = val('edDescription')
  const combineMode = ($('edCombine') as HTMLInputElement)?.checked ?? false
  try {
    // Combine mode mints an EP whose content is a REFERENCE manifest (pointers to existing mints, no re-upload);
    // otherwise embed the picked file(s) as usual.
    const file = combineMode ? await buildCombinedManifest(name) : await readContent($('edFile') as HTMLInputElement, name)
    if (combineMode && file == null) { setStatus('Combine mode: pick at least 2 of your collections to bundle.', 'error'); return }
    const cover = croppedCover ?? await readFile($('edCover') as HTMLInputElement) // prefer the cropped/resized cover
    const backCover = await readFile($('edBackCover') as HTMLInputElement) // optional flippable back cover (sales page)
    if (encrypt && !file) { setStatus('Encryption needs a file — attach one or uncheck encrypt.', 'error'); return }
    const manifestRefs = file != null && isManifest(file.mimeType, file.bytes) ? parseManifest(file.bytes) : null
    const trackCount = file?.mimeType === ALBUM_MIME ? (parseAlbum(file.bytes)?.length ?? 0) : 0
    const fileLabel = file == null ? ''
      : manifestRefs != null ? ` (an EP referencing ${manifestRefs.length} mint${manifestRefs.length === 1 ? '' : 's'} — no re-upload)`
      : trackCount > 0 ? ` (embedding a ${trackCount}-track album, ${kb(file.bytes.length)})`
      : ` (embedding a ${kb(file.bytes.length)} file)`
    if (file != null && !confirmAudioFidelity(file)) { setStatus('Mint cancelled — compress the file first, or proceed as-is when you’re ready.'); return }
    // v1 fixed-fee editions only. Covenant v2 (percentage/ranged pricing) stays in the codebase
    // (createEditionV2 / replicateEditionV2 / parseEditionScriptV2) but is hidden from the UI until built out.
    const terms = ownTerms()
    setStatus('Preparing the edition mint…')
    const result = await createEdition(provider, k, {
      tokenName: name, terms, mintCount: count, file, encrypt, description, cover, backCover,
      confirmSpend: total => confirm(
        `Mint ${count} edition${count > 1 ? 's' : ''} of “${name}”${encrypt ? ' (encrypted)' : ''}${fileLabel}?\n\n` +
        `This spends ${total.toLocaleString()} sats from your wallet — including a refundable ${(terms.tokenSats ?? EDITION_BOND_SATS).toLocaleString()}-sat bond per edition (reclaimable by burning), plus the network fee.\n\n` +
        `Buyers later pay the publisher ${terms.publisherFeeSats} + holder ${terms.holderFeeSats} sats per copy.\n\nProceed?`),
    })
    for (const e of result.editions) storeEdition(e, result.collectionId, name, terms)
    renderTokens()
    setStatusHtml(`Minted ${result.editions.length} edition(s). Collection ${idChip(result.collectionId)} (TX2 ${idChip(result.tx2Id)}).`, 'ok')
  } catch (e) {
    if ((e as Error).message === SPEND_CANCELLED) { setStatus('Edition mint cancelled — nothing was spent.'); return }
    setStatus(`Edition mint failed: ${(e as Error).message}`, 'error')
  }
}

// ── Combine mode: mint an EP whose content is a reference manifest (pointers to existing mints) ──
/** Read each picked collection's committed fileHash + name — a cheap template-only load via loadCollection,
 *  NOT a content download — and pack them into a reference manifest to mint as the EP's content. Returns
 *  undefined if fewer than 2 are picked (an EP needs at least two). Throws if a pick has no embedded content. */
async function buildCombinedManifest(epName: string): Promise<{ mimeType: string; fileName: string; bytes: number[] } | undefined> {
  const ids = checkedCombineIds()
  if (ids.length < 2) return undefined
  setStatus(`Reading ${ids.length} collections to build the EP…`)
  const refs: ManifestRef[] = []
  for (const id of ids) {
    const info = await loadCollection(id)
    if (!info.hasContentFile || info.fileHash == null) throw new Error(`"${info.name || short(id)}" has no embedded content to reference`)
    if (info.encrypted) throw new Error(`"${info.name || short(id)}" is encrypted — EPs can only reference public content for now`)
    refs.push({ id, hash: info.fileHash, name: info.name || short(id), mimeType: 'application/octet-stream' })
  }
  const safe = (epName || 'ep').replace(/[^\w.-]+/g, '_')
  return { mimeType: MANIFEST_MIME, fileName: `${safe}.pref`, bytes: packManifest(refs) }
}
function checkedCombineIds(): string[] {
  return Array.from(document.querySelectorAll('.combine-pick:checked')).map(c => (c as HTMLInputElement).value)
}
function updateCombineHint(): void {
  const hint = $('edCombineHint'); if (hint == null) return
  const n = checkedCombineIds().length
  hint.textContent = n < 2 ? `Select 2 or more (${n} picked).` : `${n} selected — they’ll play as one EP.`
}
/** Populate the combine picker from the collections this wallet holds (deduped) — your singles to bundle. */
function renderCombinePicker(): void {
  const list = $('edCombineList'); if (list == null) return
  list.innerHTML = ''
  const seen = new Set<string>()
  const cols = store.active().filter(t => { if (seen.has(t.collectionId)) return false; seen.add(t.collectionId); return true })
  if (cols.length === 0) { list.innerHTML = '<li class="muted" style="font-size:12px">No collections in this wallet yet — mint or hold some singles first.</li>'; updateCombineHint(); return }
  for (const t of cols) {
    const li = document.createElement('li'); li.className = 'combine-row'
    const label = document.createElement('label'); label.className = 'check'
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'combine-pick'; cb.value = t.collectionId
    cb.onchange = updateCombineHint
    label.append(cb, document.createTextNode(' ' + (t.collectionName || short(t.collectionId))))
    const idSpan = document.createElement('span'); idSpan.className = 'muted'; idSpan.style.fontSize = '11px'; idSpan.textContent = short(t.collectionId)
    li.append(label, idSpan); list.append(li)
  }
  updateCombineHint()
}

/** The note (promo + bonus) to carry when I sell/transfer an edition I hold: my own published note wins,
 *  else the note that came with this copy (sticky default → hands-off propagation). */
async function noteToPropagate(t: StoredToken): Promise<SellerNote | undefined> {
  try { const p = await resolveSellerNote(provider, pubKeyHex, t.collectionId); if (p && noteHasContent(p)) return p } catch { /* best-effort */ }
  if (t.sellerNote || t.bonusValue) return { text: t.sellerNote ?? '', bonusKind: t.bonusKind, bonusValue: t.bonusValue }
  return undefined
}

/** When a covenant action is rejected with "missing or spent", the edition's UTXO may be genuinely gone
 *  (already moved/burned, possibly in another session/wallet) while still lingering in the local cache —
 *  PushDrop editions aren't address-indexed, so Refresh can't reconcile them. Confirm by querying the
 *  edition's own locking script: if its exact outpoint is no longer unspent, drop the stale entry so the
 *  dead card self-heals. Returns true if it pruned (genuinely spent), false if still live (transient/unpropagated). */
async function pruneIfEditionSpent(t: StoredToken): Promise<boolean> {
  if (!t.lockHex) return false
  try {
    const unspent = await provider.getUnspentByScriptHash(wocScriptHash(Utils.toArray(t.lockHex, 'hex')))
    if (unspent.some(u => u.txId === t.txId && u.outputIndex === t.outputIndex)) return false // still live — keep it
    store.markSent(t.txId, t.outputIndex) // genuinely spent: retire the stale active entry
    renderTokens()
    return true
  } catch {
    return false // network hiccup — don't prune on uncertainty
  }
}

async function onReplicate(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  if (!t.lockHex) { setStatus('Missing edition script; cannot replicate.', 'error'); return }
  const name = t.collectionName ?? 'this edition'
  // A bonded edition's replica carries the same refundable bond — the dominant non-fee cost — so call it out.
  const bondNote = editionSupportsBurn(Utils.toArray(t.lockHex, 'hex'))
    ? 'a refundable bond for your copy (reclaim it by burning) + ' : ''
  setStatus('Preparing the replication…')
  try {
    // v2 (percentage pricing) editions go through the computed-split replicate.
    if (parseEditionScriptV2(LockingScript.fromHex(t.lockHex)) != null) {
      const r = await replicateEditionV2(provider, k, {
        editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex,
        confirmSpend: total => confirm(
          `Replicate a copy of “${name}”?\n\nThis spends ${total.toLocaleString()} sats from your wallet (${bondNote}the seller’s price + network fee).\n\nProceed?`),
      })
      store.markSent(t.txId, t.outputIndex) // original spent; token returned to holder at out[0] (new outpoint)
      storeEdition({ txId: r.txId, outputIndex: 0, lockHex: t.lockHex }, t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
      storeEdition({ txId: r.replicaOutpoint.txId, outputIndex: r.replicaOutpoint.outputIndex, lockHex: r.lockHex }, t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
      renderTokens()
      setStatus(`✅ v2 replicated. Tx ${short(r.txId)} — publisher ${r.publisherCut} + reseller ${r.resellerCut} sats.`, 'ok')
      return
    }
    const note = await noteToPropagate(t)
    const r = await replicateEdition(provider, k, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex, terms: termsFromToken(t),
      note,
      confirmSpend: total => confirm(
        `Replicate a copy of “${name}”?\n\n` +
        `This spends ${total.toLocaleString()} sats from your wallet (${bondNote}publisher ${t.publisherFeeSats ?? 0} + holder ${t.holderFeeSats ?? 0} fees + network fee).\n\nProceed?`),
    })
    // The original UTXO is now spent; it was re-created at out[0] (token back to the holder = us, verbatim).
    store.markSent(t.txId, t.outputIndex)
    storeEdition({ txId: r.txId, outputIndex: 0, lockHex: t.lockHex },
      t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t),
      t.sellerNote || t.bonusValue ? { text: t.sellerNote ?? '', bonusKind: t.bonusKind, bonusValue: t.bonusValue } : null)
    // The buyer's new replica (out[1]) is also ours in a self-test — it carries the propagated note.
    storeEdition({ txId: r.replicaOutpoint.txId, outputIndex: r.replicaOutpoint.outputIndex, lockHex: r.lockHex },
      t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t), note)
    renderTokens()
    setStatus(`✅ Replicated. Tx ${short(r.txId)} — NFT returned to holder, replica minted, fees paid.`, 'ok')
  } catch (e) {
    const msg = (e as Error).message
    if (msg === SPEND_CANCELLED) { setStatus('Replication cancelled — nothing was spent.'); return }
    if (/missing inputs|missingorspent/i.test(msg) && await pruneIfEditionSpent(t)) {
      setStatus('That edition had already been spent (moved or burned elsewhere) — removed it from your holdings.', 'ok'); return
    }
    setStatus(`Replicate failed: ${msg}`, 'error')
  }
}

async function onTransferEdition(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  const recipient = val('sendPubKey')
  if (recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex) above.", 'error'); return
  }
  if (!t.lockHex) { setStatus('Missing edition script; cannot transfer.', 'error'); return }
  setStatus('Transferring edition (owner-signed, re-creating covenant)…')
  try {
    const note = await noteToPropagate(t)
    const r = await transferEdition(provider, k, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex,
      newOwnerPubKey: Utils.toArray(recipient, 'hex'), note,
    })
    store.markSent(t.txId, t.outputIndex)
    renderTokens()
    setStatus(`✅ Transferred. Tx ${short(r.txId)} — covenant re-created for the new owner.`, 'ok')
  } catch (e) {
    const msg = (e as Error).message
    if (/missing inputs|missingorspent/i.test(msg) && await pruneIfEditionSpent(t)) {
      setStatus('That edition had already been spent (moved or burned elsewhere) — removed it from your holdings.', 'ok'); return
    }
    setStatus(`Transfer failed: ${msg}`, 'error')
  }
}

/** Onboard a listing partner: transfer THIS copy to a listing wallet's pubkey (a curation site, or your own
 *  cold listing wallet). That wallet holds + resells the copy, collecting the reseller fee on sales via its
 *  link; the publisher fee still goes to the collection's publisher. Returns the wallet's ready listing link. */
/** Set by a "List your NFT here" deep link (#list=<pubkey>): the listing wallet to onboard the next copy to. */
let pendingListPartner: string | null = null

async function onOnboardPartner(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  if (!t.lockHex) { setStatus('Missing edition script; cannot onboard.', 'error'); return }
  const name = t.collectionName ?? 'this collection'
  let partner: string
  if (pendingListPartner) {
    // Pre-filled from a curation site's "List your NFT here" link — the publisher just picks a collection + confirms.
    partner = pendingListPartner
    if (!confirm(`List “${name}” on listing wallet ${short(partner)}?\n\nThis sends one copy there; that wallet then holds and resells it, earning the reseller fee on each sale. You keep your other copies and your publisher fee.`)) return
  } else {
    partner = (prompt(
      `List “${name}” through a partner wallet.\n\n` +
      `Paste the PUBLIC KEY (66-hex) of the listing wallet — a curation site's, or your own cold listing wallet. ` +
      `You'll transfer THIS copy to it; that wallet then holds and resells the copy, collecting the reseller fee ` +
      `on every sale made through its link. (You keep your other copies.)`) ?? '').trim().toLowerCase()
    if (partner === '') return
    if (!/^0[23][0-9a-f]{64}$/.test(partner)) {
      setStatus('That isn’t a 33-byte compressed public key (66 hex, starting 02 or 03).', 'error'); return
    }
    if (!confirm(`Transfer one copy of “${name}” to ${short(partner)}? That wallet then holds and resells this copy.`)) return
  }
  setStatus('Onboarding partner (transferring a copy)…')
  try {
    const note = await noteToPropagate(t)
    const r = await transferEdition(provider, k, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex,
      newOwnerPubKey: Utils.toArray(partner, 'hex'), note,
    })
    store.markSent(t.txId, t.outputIndex)
    renderTokens()
    pendingListPartner = null // consume the one-shot deep-link target
    const link = collectionShareUrl(t.collectionId, partner)
    setStatus(`✅ Partner onboarded. Tx ${short(r.txId)} — share their listing link.`, 'ok')
    showPartnerLinkModal(name, link, partner)
  } catch (e) {
    const msg = (e as Error).message
    if (/missing inputs|missingorspent/i.test(msg) && await pruneIfEditionSpent(t)) {
      setStatus('That copy had already been spent (moved or burned elsewhere) — removed it from your holdings.', 'ok'); return
    }
    setStatus(`Onboarding failed: ${msg}`, 'error')
  }
}

/** Show the partner's ready-made listing link (copyable + QR) after onboarding. */
function showPartnerLinkModal(name: string, link: string, partnerPubKey: string): void {
  const overlay = document.createElement('div'); overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:520px">' +
    '<div class="modal-head"><span>🤝 Listing partner onboarded</span><button class="secondary pl-close">✕ Close</button></div>' +
    `<p class="muted" style="font-size:13px;margin:0 0 10px">A copy of “${escapeHtml(name)}” now sits in the wallet you entered — your <b>listing partner</b> (a curation site, or your own listing wallet). Share its link below: every buyer mints their own copy from it, so that wallet <b>collects the reseller fee</b> on each sale, while the <b>publisher fee</b> goes to the collection’s publisher. The copy isn’t used up — it keeps selling.</p>` +
    '<label>Partner listing link</label>' +
    `<div class="row" style="flex-wrap:nowrap;gap:6px"><input class="pl-link mono" readonly value="${escapeHtml(link)}" style="flex:1 1 auto;min-width:0" /><button class="secondary pl-copy">Copy</button><button class="secondary pl-qr">QR</button></div>` +
    `<p class="muted" style="font-size:11px;margin:10px 0 0">Partner key: <span class="mono">${escapeHtml(partnerPubKey)}</span></p>` +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.pl-close')?.addEventListener('click', close)
  overlay.querySelector('.pl-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(link))
  overlay.querySelector('.pl-qr')?.addEventListener('click', () => showQrModal('Partner listing link', link))
  document.body.append(overlay)
}

/** Burn an owned edition: owner-signed spend that destroys the token and reclaims its bond to your wallet. */
async function onBurn(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  if (!t.lockHex) { setStatus('Missing edition script; cannot burn.', 'error'); return }
  if (!confirm(
    `Burn your edition of “${t.collectionName ?? 'this collection'}” and reclaim its ~${(t.tokenSats ?? EDITION_BOND_SATS).toLocaleString()}-sat bond ` +
    `(minus a small network fee) to your wallet?\n\n⚠ This DESTROYS the token permanently — it cannot be undone. Proceed?`)) return
  setStatus('Burning edition (reclaiming the bond)…')
  try {
    const r = await burnEdition(provider, k, { editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex })
    store.markSent(t.txId, t.outputIndex) // the token is destroyed
    renderTokens()
    setStatus(`🔥 Burned. Reclaimed ${r.reclaimSats.toLocaleString()} sats to your wallet. Tx ${short(r.txId)}.`, 'ok')
  } catch (e) {
    const msg = (e as Error).message
    console.error(`[burn] failed for ${t.txId}:${t.outputIndex} —`, msg)
    // The node's "Missing inputs" (bad-txns-inputs-missingorspent) means the edition's UTXO is either not yet
    // visible (unconfirmed/unpropagated) OR already spent. A raw-tx fetch 404 = the parent tx isn't indexed yet.
    // Don't claim "unconfirmed" — it may have been moved or already burned and the local cache is stale.
    if (/missing inputs|missingorspent/i.test(msg)) {
      const pruned = await pruneIfEditionSpent(t)
      setStatus(pruned
        ? 'This edition had already been spent (moved or burned elsewhere) — removed it from your holdings.'
        : 'Burn failed: this edition isn’t confirmed/propagated yet. Wait a few minutes, then try again.', pruned ? 'ok' : 'error')
    } else if (/raw TX fetch failed/i.test(msg)) {
      setStatus('Burn failed: this edition’s transaction isn’t on-chain yet. Wait for it to confirm (usually a few minutes), then try again.', 'error')
    } else {
      setStatus(`Burn failed: ${msg}`, 'error')
    }
  }
}

// ─── air-gapped signing (Advanced) ──────────────────────────────────
// Online box exports an unsigned request → offline box signs it with the key → online box broadcasts.
// Only files cross the gap; the key never leaves the offline machine. Engine in airgap.ts.

function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function readFileText(input: HTMLInputElement): Promise<string | null> {
  const f = input.files?.[0]
  return f ? f.text() : Promise.resolve(null)
}

/** Fill the edition picker with the wallet's held covenant editions (the only spendable air-gap targets). */
function populateAirgapEditions(): void {
  const sel = document.getElementById('agEdition') as HTMLSelectElement | null
  if (sel == null) return
  const prev = sel.value
  const held = store.active().filter(t => t.kind === 'edition' && t.lockHex)
  sel.innerHTML = held.length === 0
    ? '<option value="">(no editions held)</option>'
    : held.map(t => `<option value="${t.txId}:${t.outputIndex}">${escapeHtml(t.collectionName ?? 'Edition')} · ${short(t.txId, 6)}:${t.outputIndex}</option>`).join('')
  if (held.some(t => `${t.txId}:${t.outputIndex}` === prev)) sel.value = prev
}

/** Toggle the recipient field by the chosen action (burn needs no recipient). */
function syncAirgapAction(): void {
  const action = (document.querySelector('input[name="agAction"]:checked') as HTMLInputElement | null)?.value
  const row = document.getElementById('agRecipientRow')
  if (row != null) row.style.display = action === 'burn' ? 'none' : ''
}

/** Step 1 (online): gather the edition + funding inputs and download a keyless signing request. */
async function onAirgapExport(): Promise<void> {
  const t = store.active().find(x => `${x.txId}:${x.outputIndex}` === val('agEdition'))
  if (t == null || !t.lockHex) { setStatus('Select an edition to export.', 'error'); return }
  const action = ((document.querySelector('input[name="agAction"]:checked') as HTMLInputElement | null)?.value ?? 'transfer') as AirgapAction
  const recipient = val('agRecipient')
  if (action === 'transfer' && recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex) to export a transfer.", 'error'); return
  }
  setStatus('Gathering inputs for the offline signer…')
  try {
    const sourceTx = await provider.getSourceTransaction(t.txId)
    const bond = sourceTx.outputs[t.outputIndex]?.satoshis ?? PHARLAP_OUTPUT_SATS
    const edition: EditionUtxo = { txId: t.txId, outputIndex: t.outputIndex, satoshis: bond, lockBytes: Utils.toArray(t.lockHex, 'hex'), sourceTx }
    const name = t.collectionName ?? 'edition'
    let req: AirgapRequest
    if (action === 'burn') {
      req = buildAirgapRequest('burn', edition, {
        summary: `Burn edition of “${name}” (${short(t.txId, 6)}:${t.outputIndex}); reclaim ~${bond.toLocaleString()} sats to the signer's wallet.`,
      })
    } else {
      const note = await noteToPropagate(t)
      const noteSats = note ? PHARLAP_OUTPUT_SATS : 0
      const estFee = Math.ceil((1500 * DEFAULT_FEE_PER_KB) / 1000)
      const selected = selectFunding(await getSafeUtxos(provider), noteSats + estFee + 1000)
      const funding = await toFundingInputs(provider, selected)
      req = buildAirgapRequest('transfer', edition, {
        newOwnerPubKeyHex: recipient, note, funding,
        summary: `Transfer edition of “${name}” (${short(t.txId, 6)}:${t.outputIndex}) to ${short(recipient, 8)}; ${bond.toLocaleString()}-sat bond rides forward.`,
      })
    }
    downloadText(`smartnfts-${action}-${t.txId.slice(0, 8)}.airgap-request.json`, encodeAirgapRequest(req), 'application/json')
    setStatus(`✅ Exported ${action} request. Move the file to your offline machine and sign it there (step 2).`, 'ok')
  } catch (e) {
    setStatus(`Export failed: ${(e as Error).message}`, 'error')
  }
}

let pendingSignReq: AirgapRequest | null = null
/** Step 2a (offline): read + validate an imported request and show what will be signed. */
async function onAirgapSignFile(): Promise<void> {
  pendingSignReq = null
  const sumEl = $('agSignSummary'); const btn = $('btnAgSign') as HTMLButtonElement
  const txt = await readFileText($('agSignFile') as HTMLInputElement)
  if (txt == null) { sumEl.textContent = ''; btn.disabled = true; return }
  try {
    const req = decodeAirgapRequest(txt)
    pendingSignReq = req
    sumEl.textContent = `${req.action.toUpperCase()} — ${req.summary ?? '(no summary in request)'}`
    sumEl.style.color = ''
    btn.disabled = false
  } catch (e) {
    sumEl.textContent = `⚠ Not a valid request: ${(e as Error).message}`
    sumEl.style.color = 'var(--err, #f85149)'
    btn.disabled = true
  }
}
/** Step 2b (offline): sign the imported request with this wallet's key and download the signed raw tx. */
async function onAirgapSign(): Promise<void> {
  const k = requireKey(); if (k == null) return // signing happens on the offline (keyed) box, not a watch-only one
  if (pendingSignReq == null) { setStatus('Import a request file first.', 'error'); return }
  setStatus('Signing offline…')
  try {
    const { txId, rawTx } = await signAirgapRequest(pendingSignReq, k)
    downloadText(`smartnfts-signed-${txId.slice(0, 8)}.txt`, rawTx)
    setStatus(`✅ Signed (tx ${short(txId)}). Move the signed file to your online machine and broadcast it (step 3).`, 'ok')
  } catch (e) {
    setStatus(`Sign failed: ${(e as Error).message}`, 'error')
  }
}

/** Step 3 (online): broadcast a signed raw tx imported from the offline machine. */
async function onAirgapBroadcast(): Promise<void> {
  let hex = val('agBcHex')
  if (hex.length === 0) hex = ((await readFileText($('agBcFile') as HTMLInputElement)) ?? '').trim()
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 20) { setStatus('Import or paste the signed raw-tx hex first.', 'error'); return }
  setStatus('Broadcasting signed transaction…')
  try {
    const txId = await provider.broadcast(hex)
    ;($('agBcHex') as HTMLTextAreaElement).value = ''
    setStatus(`✅ Broadcast. Tx ${short(txId)}. Refresh balance / check holdings to see it settle.`, 'ok')
  } catch (e) {
    setStatus(`Broadcast failed: ${(e as Error).message}`, 'error')
  }
}

// ─── Send BSV (plain P2PKH payment) ─────────────────────────────────
/** Read + validate the Send-BSV form. Returns null (after setting an error status) if invalid. */
function readSendBsvForm(): { toAddress: string; amountSats: number; sendMax: boolean } | null {
  const toAddress = val('sendBsvAddr')
  const sendMax = ($('sendBsvMax') as HTMLInputElement).checked
  try { assertValidAddress(toAddress) } catch { setStatus('Enter a valid recipient BSV address.', 'error'); return null }
  const amountSats = sendMax ? 0 : Math.floor(Number(val('sendBsvAmount')))
  if (!sendMax && (!Number.isFinite(amountSats) || amountSats < 1)) {
    setStatus('Enter an amount of at least 1 sat (or tick “Send max”).', 'error'); return null
  }
  return { toAddress, amountSats, sendMax }
}

/** Online: build, sign and broadcast a plain BSV payment. */
async function onSendBsv(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const form = readSendBsvForm()
  if (form == null) return
  if (!confirm(`Send ${form.sendMax ? 'your entire spendable balance' : `${form.amountSats.toLocaleString()} sats`} to\n${form.toAddress}?\n\n(Minus the network fee. Change returns to this wallet.)`)) return
  setStatus('Sending BSV…')
  try {
    const r = await sendPayment(provider, k, form)
    ;($('sendBsvAddr') as HTMLInputElement).value = ''
    ;($('sendBsvAmount') as HTMLInputElement).value = ''
    ;($('sendBsvMax') as HTMLInputElement).checked = false
    setStatus(`✅ Sent ${r.sentSats.toLocaleString()} sats. Tx ${short(r.txId)}.`, 'ok')
    void refreshBalance()
  } catch (e) {
    setStatus(`Send failed: ${(e as Error).message}`, 'error')
  }
}

/** Air-gap: gather the funding online and export an unsigned payment request to sign offline. */
async function onSendBsvExport(): Promise<void> {
  const form = readSendBsvForm()
  if (form == null) return
  setStatus('Gathering funds for the offline signer…')
  try {
    const funding = await gatherPaymentFunding(provider, form)
    if (funding.length === 0) { setStatus('No spendable funds to send.', 'error'); return }
    // Dry-run the build to surface the exact figure (and catch insufficient funds) before exporting. Uses a
    // throwaway key purely for SIZING — the tx is never broadcast and the real signer rebuilds it — so this
    // works even in watch-only mode where no private key is present.
    const dry = await buildPaymentTx({ key: PrivateKey.fromRandom(), funding, ...form })
    const req = buildAirgapPaymentRequest({
      ...form, funding,
      summary: `Send ${dry.sentSats.toLocaleString()} sats to ${form.toAddress}${form.sendMax ? ' (entire balance, minus fee)' : ''}.`,
    })
    downloadText(`smartnfts-payment-${dry.txId.slice(0, 8)}.airgap-request.json`, encodeAirgapRequest(req), 'application/json')
    setStatus(`✅ Exported payment request (${dry.sentSats.toLocaleString()} sats). Sign it on your offline machine (step 2 in Advanced), then broadcast (step 3).`, 'ok')
  } catch (e) {
    setStatus(`Export failed: ${(e as Error).message}`, 'error')
  }
}

// ─── send ───────────────────────────────────────────────────────────
async function onSend(txId: string, outputIndex: number): Promise<void> {
  const k = requireKey(); if (k == null) return
  const recipient = val('sendPubKey')
  if (recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex).", 'error'); return
  }
  setStatus('Sending NFT…')
  try {
    const result = await createTransfer(provider, k, { tokenTxId: txId, tokenOutputIndex: outputIndex, recipientPubKeyHex: recipient })
    store.markSent(txId, outputIndex)
    renderTokens()
    setStatus(`Sent. Transfer tx ${short(result.txId)} (recipient notified at output ${result.notifyVout}).`, 'ok')
  } catch (e) {
    setStatus(`Send failed: ${(e as Error).message}`, 'error')
  }
}

// ─── messaging ──────────────────────────────────────────────────────
async function onSendMessage(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const to = val('msgTo')
  if (to.length !== 66 && to.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex).", 'error'); return
  }
  const text = ($('msgText') as HTMLTextAreaElement).value
  const encrypt = ($('msgEncrypt') as HTMLInputElement).checked
  const file = await readFile($('msgFile') as HTMLInputElement)
  const parts: Part[] = []
  if (text.trim()) parts.push({ kind: 'text', text })
  if (file) parts.push({ kind: 'file', mimeType: file.mimeType, fileName: file.fileName, bytes: file.bytes })
  if (parts.length === 0) { setStatus('Write a message or attach a file first.', 'error'); return }
  setStatus(`Sending ${encrypt ? 'encrypted' : 'public'} message…`)
  try {
    const r = await sendMessage(provider, k, { toPubKeyHex: to, parts, encrypt, senderAlias: getMyAlias() })
    ;($('msgText') as HTMLTextAreaElement).value = ''
    setStatus(`Message sent. Tx ${short(r.txId)}.`, 'ok')
  } catch (e) {
    setStatus(`Send message failed: ${(e as Error).message}`, 'error')
  }
}

/** Publish your profile (alias + optional avatar) on-chain so others resolve your @name + face by pubkey. */
async function onPublishProfile(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const alias = getMyAlias()
  const file = await readFile($('profileAvatar') as HTMLInputElement)
  let avatar: { mimeType: string; bytes: number[] } | undefined
  if (file != null) {
    if (!file.mimeType.startsWith('image/')) { setStatus('Avatar must be an image.', 'error'); return }
    const small = await downscaleToAvatar(file.bytes, file.mimeType)
    if (small == null) { setStatus('Could not process that image (need a browser that encodes WebP).', 'error'); return }
    avatar = small
  }
  if (alias === '' && avatar == null) { setStatus('Set an alias (above) or choose an avatar image first.', 'error'); return }
  if (!confirm(
    `Publish your profile on-chain${avatar ? ` (a ${kb(avatar.bytes.length)} avatar)` : ''}${alias ? ` as @${alias}` : ''}?\n\n` +
    `It's posted to your own address and spends a small network fee. Proceed?`)) return
  setStatus('Publishing your profile…')
  try {
    const txId = await publishProfile(provider, k, { alias: alias || undefined, avatar })
    if (avatar != null) { setAvatar(myPubKeyLc(), bytesToDataUrl(avatar.mimeType, avatar.bytes)); renderWallet() }
    ;($('profileAvatar') as HTMLInputElement).value = ''
    setStatus(`✅ Profile published. Tx ${short(txId)} — others now resolve your @name + avatar by your key.`, 'ok')
  } catch (e) {
    setStatus(`Publish profile failed: ${(e as Error).message}`, 'error')
  }
}

async function onCheckMessages(): Promise<void> {
  const k = requireKey(); if (k == null) return // messages are encrypted to the key; can't read them watch-only
  setStatus('Checking for messages…')
  try {
    const msgs = await scanIncomingMessages(provider, k)
    // Apply only each sender's LATEST self-claim. msgs are newest-first, so the first alias seen per sender
    // is the newest — applying every message would let an older one revert a more recent rename.
    applyLatestAliases(msgs.map(m => ({ pk: m.senderPubKeyHex, alias: m.senderAlias })))
    renderInbox(msgs)
    resolveAvatarsThen(msgs.map(m => m.senderPubKeyHex), () => renderInbox(lastInbox))
    setStatus(`Inbox: ${msgs.length} message(s).`, 'ok')
  } catch (e) {
    setStatus(`Check messages failed: ${(e as Error).message}`, 'error')
  }
}

function renderInbox(msgs: IncomingMessage[]): void {
  lastInbox = msgs
  const host = $('inbox')
  if (msgs.length === 0) { host.innerHTML = '<p class="muted">No messages found.</p>'; return }
  host.innerHTML = ''
  for (const m of msgs) {
    const card = document.createElement('div')
    card.className = 'token msg' // .msg overrides the NFT flex-row so content stacks and actions sit bottom-left
    const textPart = m.parts.find(p => p.kind === 'text')
    const hasKey = m.parts.some(p => p.kind === 'key')
    const filePart = m.parts.find(p => p.kind === 'file')
    card.innerHTML = `
      <div class="mono">from ${nameChip(m.senderPubKeyHex, { save: true })} ${m.encrypted ? '🔒 encrypted' : '🌐 public'}</div>
      ${m.sentAt ? `<div class="muted" style="font-size:11px" title="Sender's clock (self-asserted)">🕒 ${escapeHtml(fmtTime(m.sentAt))}${m.height ? '' : ' · pending'}</div>` : (m.height ? '' : '<div class="muted" style="font-size:11px">pending</div>')}
      ${textPart && textPart.kind === 'text' ? `<div class="state">${escapeHtml(textPart.text)}</div>` : ''}
      ${hasKey ? '<div class="muted" style="font-size:12px">🔑 carries a content key</div>' : ''}
    `
    const actions = document.createElement('div')
    actions.className = 'actions'
    const reply = document.createElement('button')
    reply.textContent = '↩ Reply'
    reply.className = 'secondary'
    reply.onclick = () => onReply(m)
    actions.append(reply)
    if (filePart && filePart.kind === 'file') {
      const btn = document.createElement('button')
      btn.textContent = `View ${filePart.fileName}`
      btn.className = 'secondary'
      btn.onclick = () => showFile('Message attachment', { mimeType: filePart.mimeType, fileName: filePart.fileName, fileBytes: filePart.bytes }, true)
      actions.append(btn)
    }
    card.append(actions)
    host.append(card)
  }
}

/** Reply: drop the sender's key into the compose box, match its privacy, and focus the message field. */
function onReply(m: IncomingMessage): void {
  ;($('msgTo') as HTMLInputElement).value = m.senderPubKeyHex
  ;($('msgEncrypt') as HTMLInputElement).checked = m.encrypted
  updateMsgToName()
  $('msgTo').scrollIntoView({ behavior: 'smooth', block: 'start' })
  ;($('msgText') as HTMLTextAreaElement).focus()
  const who = displayName(m.senderPubKeyHex)
  setStatus(`Replying to ${who.name}.`)
}

// ─── check incoming ─────────────────────────────────────────────────
// A received edition's token doesn't carry the collection title (that lives in TX1's template), so the
// incoming scan defaults it to "Edition". Resolve the real name from TX1 (cached per collection).
const nameCache = new Map<string, string>()
/** Latest publisher announcement per collection, filled by the Updates feed; My tokens shows it inline. */
const latestBroadcast = new Map<string, Broadcast>()
async function resolveCollectionName(tx1RefHex: string): Promise<string> {
  const cached = nameCache.get(tx1RefHex)
  if (cached != null) return cached
  let name = 'Edition'
  try {
    const tx1 = await provider.getSourceTransaction(tx1RefHex)
    for (const o of tx1.outputs) {
      const t = parseTemplateScript(o.lockingScript)
      if (t && t.fields.tokenName) { name = t.fields.tokenName; break }
    }
  } catch { /* keep fallback */ }
  nameCache.set(tx1RefHex, name)
  return name
}

async function onCheckIncoming(): Promise<void> {
  setStatus('Scanning for incoming NFTs and editions…')
  let added = 0
  let edAdded = 0
  const errors: string[] = []

  // Plain PushDrop tokens.
  try {
    const incoming = await scanIncoming(provider, pubKeyHex)
    for (const t of incoming) {
      const tx = await provider.getSourceTransaction(t.txId)
      const v = await verifyTokenLineage(tx, t.outputIndex, { getRawTransaction: id => provider.getSourceTransaction(id) })
      if (!v.valid) continue
      if (store.add({ txId: t.txId, outputIndex: t.outputIndex, collectionId: t.fields.tx1Ref, stateData: t.fields.stateData })) added++
    }
  } catch (e) { errors.push(`tokens: ${(e as Error).message}`) }

  // Edition covenant outputs (not address-indexed) — found via the transfer notification breadcrumb.
  // Run independently so a plain-scan failure can't block it.
  try {
    const editions = await scanIncomingEditions(provider, pubKeyHex)
    for (const e of editions) {
      const name = await resolveCollectionName(e.tx1RefHex)
      if (store.add({
        txId: e.txId, outputIndex: e.outputIndex, collectionId: e.tx1RefHex, stateData: '', collectionName: name,
        kind: 'edition', lockHex: e.lockHex, publisherPubKeyHashHex: Utils.toHex(e.terms.publisherPubKeyHash),
        publisherFeeSats: e.terms.publisherFeeSats, holderFeeSats: e.terms.holderFeeSats,
        ...(e.sellerNote?.text ? { sellerNote: e.sellerNote.text } : {}),
        ...(e.sellerNote?.bonusValue ? { bonusKind: e.sellerNote.bonusKind, bonusValue: e.sellerNote.bonusValue } : {}),
        ...(e.height ? { heightHint: e.height } : {}),
      })) edAdded++
      else store.setCollectionName(e.txId, e.outputIndex, name) // backfill the real title on older "Edition" entries
    }
  } catch (e) { errors.push(`editions: ${(e as Error).message}`) }

  renderTokens()
  if (errors.length > 0 && added === 0 && edAdded === 0) {
    setStatus(`Scan failed — ${errors.join('; ')}`, 'error')
  } else {
    setStatus(`Scan complete: ${added} NFT(s) + ${edAdded} edition(s) new.${errors.length ? ' (' + errors.join('; ') + ')' : ''}`, 'ok')
  }
}

// ─── verify ─────────────────────────────────────────────────────────
async function onVerify(txId: string, outputIndex: number): Promise<void> {
  setStatus('Verifying NFT lineage…')
  try {
    const tx = await provider.getSourceTransaction(txId)
    // Edition covenant: O(1) bind to the collection — byte-match the token's covenant against the template
    // TX1 committed (proves genuine, immutable rules; no lineage walk needed — see verify.ts / MPT thesis).
    if (parseEditionAny(tx.outputs[outputIndex]?.lockingScript) != null) {
      setStatus('Verifying edition against its collection…')
      const r = await verifyEditionCovenant(tx, outputIndex, { getRawTransaction: id => provider.getSourceTransaction(id) })
      if (!r.valid) { setStatus(`❌ ${r.reason}${r.collectionName ? ` — “${r.collectionName}”` : ''}`, 'error'); return }
      const econ = r.isV2 ? `publisher ${((r.pBps ?? 0) / 100).toFixed(2)}% · price ${r.priceSats} sats` : `fees ${r.publisherFeeSats}/${r.holderFeeSats} sats`
      // Provenance: the collection's on-chain anchor (TX1) — its txid + when it was mined (best-effort).
      let anchor = `TX1 ${short(r.collectionId ?? '')}`
      try {
        const conf = await provider.getTxConfirmation(r.collectionId ?? '')
        anchor += conf != null ? ` · anchored at block ${conf.blockHeight.toLocaleString()} (${fmtUtc(conf.time * 1000)})` : ' · pending confirmation'
      } catch { /* provenance is best-effort */ }
      setStatus(`✅ ${r.reason}${r.collectionName ? ` — “${r.collectionName}”` : ''} · ${econ} (verified against ${anchor}).`, 'ok')
      return
    }
    const deps = { getRawTransaction: (id: string) => provider.getSourceTransaction(id) }
    const v = await verifyTokenLineage(tx, outputIndex, deps)
    // Read collection name from TX1 for display.
    let name = ''
    try {
      const tx1 = await provider.getSourceTransaction(v.collectionId ?? '')
      for (const o of tx1.outputs) { const tmpl = parseTemplateScript(o.lockingScript); if (tmpl) { name = tmpl.fields.tokenName; break } }
    } catch { /* ignore */ }
    setStatus(`${v.valid ? '✅' : '❌'} ${v.reason}${name ? ` — collection "${name}"` : ''}`, v.valid ? 'ok' : 'error')
  } catch (e) {
    setStatus(`Verify failed: ${(e as Error).message}`, 'error')
  }
}

// ─── file viewer ────────────────────────────────────────────────────
let viewerUrl: string | null = null

// ─── Content cache (IndexedDB) ──────────────────────────────────────────────
// Persist DECODED NFT content locally so re-opening it is instant + works offline, instead of re-pulling
// (and re-decoding) the whole tx from chain every time. Keyed by collection id. localStorage is far too
// small (~5 MB) for media; IndexedDB handles hundreds of MB. Entirely best-effort — any failure (private
// mode, quota, no IndexedDB) silently falls back to fetching from chain.
interface CachedContent { mimeType: string; fileName: string; bytes: Uint8Array; verified: boolean; msg: string }
const CONTENT_DB = 'pharlap-content', CONTENT_STORE = 'content'
let contentDbPromise: Promise<IDBDatabase | null> | null = null
function openContentDb(): Promise<IDBDatabase | null> {
  if (contentDbPromise != null) return contentDbPromise
  contentDbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(CONTENT_DB, 1)
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(CONTENT_STORE)) db.createObjectStore(CONTENT_STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
  return contentDbPromise
}
async function cachedContentGet(key: string): Promise<CachedContent | null> {
  const db = await openContentDb(); if (db == null) return null
  return new Promise(resolve => {
    try {
      const req = db.transaction(CONTENT_STORE, 'readonly').objectStore(CONTENT_STORE).get(key)
      req.onsuccess = () => resolve((req.result as CachedContent) ?? null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function cachedContentPut(key: string, value: CachedContent): Promise<void> {
  const db = await openContentDb(); if (db == null) return
  return new Promise(resolve => {
    try {
      const tx = db.transaction(CONTENT_STORE, 'readwrite')
      tx.objectStore(CONTENT_STORE).put(value, key)
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve()
    } catch { resolve() }
  })
}

interface DecodedContent { mimeType: string; fileName: string; bytes: number[]; verified: boolean; msg: string }

/** Fetch + decode + hash-verify ONE collection's embedded content (cache-first; persists a verified replica).
 *  Returns null if the collection has no embedded file. Throws on decode failure (caller handles) — kept
 *  status-free so it can be reused per-reference when resolving a manifest. */
async function fetchCollectionContent(collectionId: string): Promise<DecodedContent | null> {
  const hit = await cachedContentGet(collectionId)
  if (hit != null) return { mimeType: hit.mimeType, fileName: hit.fileName, bytes: Array.from(hit.bytes), verified: hit.verified, msg: hit.msg }
  const tx1 = await provider.getSourceTransaction(collectionId)
  let file: { mimeType: string; fileName: string; fileBytes: number[] } | null = null
  let template: TemplateFields | undefined
  for (const o of tx1.outputs) {
    const f = parseFileScript(o.lockingScript); if (f) file = f.fields
    const t = parseTemplateScript(o.lockingScript); if (t) template = t.fields
  }
  if (!file) {
    // Legacy plaintext provenance mints (MPT-FILE / P-FILE): unencrypted content in an OP_RETURN, authentic
    // by being the on-chain tx itself. Lets an origin mint be reused/played in a BMF composition.
    for (const o of tx1.outputs) {
      const leg = parseLegacyFileScript(o.lockingScript)
      if (leg == null) continue
      const bytes = leg.fields.fileBytes
      const msg = `📜 Legacy ${leg.marker} — original on-chain provenance mint (plaintext, unencrypted)`
      void cachedContentPut(collectionId, { mimeType: leg.fields.mimeType, fileName: leg.fields.fileName, bytes: new Uint8Array(bytes), verified: true, msg })
      return { mimeType: leg.fields.mimeType, fileName: leg.fields.fileName, bytes, verified: true, msg }
    }
    return null
  }
  const rules = template != null ? decodeTokenRules(template.tokenRules) : null
  const encrypted = rules?.isEncrypted ?? false
  // fileHash binds the ciphertext for encrypted content (privacy) but the ORIGINAL plaintext for public
  // content (provenance) — so the encrypted check runs on the raw stored blob, the public check on the plaintext.
  const ciphertextOk = encrypted && template?.fileHash === Utils.toHex(Hash.sha256(file.fileBytes))
  // Unwind the stored bytes in reverse of how they were made: decrypt first, then decompress.
  let bytes = file.fileBytes
  if (encrypted) {
    if (template?.wrappedKey == null || template?.keySalt == null) throw new Error('encrypted collection is missing its wrapped key')
    const K = unwrapContentKey(template.wrappedKey, template.keySalt)
    if (K == null) throw new Error('could not unwrap the content key')
    bytes = decryptContent(bytes, K)
  }
  if (rules?.isCompressed) bytes = await decompress(bytes)
  const verified = encrypted ? ciphertextOk : (template?.fileHash === Utils.toHex(Hash.sha256(bytes)))
  const msg = encrypted
    ? (verified ? '🔓 Decrypted — ciphertext matches the on-chain commitment ✓' : '⚠ Decrypted, but the ciphertext hash does NOT match the collection!')
    : (verified ? '✓ Verified exact replica — SHA-256 of the content matches the on-chain commitment (timestamped on mint)' : '⚠ File loaded, but its hash does NOT match the on-chain commitment!')
  // Persist the decoded content so the next open is instant + offline (only cache a verified replica).
  if (verified) void cachedContentPut(collectionId, { mimeType: file.mimeType, fileName: file.fileName, bytes: new Uint8Array(bytes), verified, msg })
  return { mimeType: file.mimeType, fileName: file.fileName, bytes, verified, msg }
}

/** Resolve a Block Media Format (BMF) manifest: fetch each on-chain component (audio + scene clips) by its
 *  txid, then hand the lot to the EXISTING scene-timeline player as an in-memory album — audio track + scene
 *  clips + a synthesized `video.cue`. Each fetched component self-verifies against its own on-chain commitment
 *  (fetchCollectionContent), so a resolved video is a composition of independently-provenanced, owned parts.
 *  A clip referenced at several cues is fetched once and reused (store-once, reference-many). */
async function viewBmf(collectionId: string, name: string, manifest: DecodedContent): Promise<void> {
  const bmf = parseBmf(manifest.bytes)
  if (bmf == null) { setStatus('This release is a Block Media manifest, but it is unreadable.', 'error'); return }
  const distinctTx = new Set(bmf.scenes.filter(s => s.tx != null).map(s => s.tx as string)).size + (bmf.audio?.tx != null ? 1 : 0)
  setStatus(`Resolving ${distinctTx} on-chain component${distinctTx === 1 ? '' : 's'} for the video…`)
  const tracks: AlbumTrack[] = []
  let missing = 0
  // Audio (referenced by tx → fetch its bytes from chain).
  let audioName = bmf.audio?.name ?? ''
  if (bmf.audio?.tx != null) {
    let d: DecodedContent | null = null
    try { d = await fetchCollectionContent(bmf.audio.tx) } catch { d = null }
    if (d != null) { audioName = bmf.audio.name || d.fileName; tracks.push({ name: audioName, mimeType: d.mimeType, bytes: d.bytes }) }
    else missing++
  }
  // Scenes — fetch each DISTINCT tx once; remember the track name it resolved to for the cue.
  const nameForTx = new Map<string, string>()
  for (const s of bmf.scenes) {
    if (s.tx == null || nameForTx.has(s.tx)) continue
    let d: DecodedContent | null = null
    try { d = await fetchCollectionContent(s.tx) } catch { d = null }
    if (d == null) { missing++; nameForTx.set(s.tx, ''); continue }
    const nm = s.name || d.fileName || `scene-${nameForTx.size + 1}.webp`
    tracks.push({ name: nm, mimeType: d.mimeType || 'image/webp', bytes: d.bytes })
    nameForTx.set(s.tx, nm)
  }
  // Synthesized cue mapping each scene time → its resolved track name (skip unresolved refs).
  const cueLines: string[] = []
  if (audioName) cueLines.push(`# audio: ${audioName}`)
  for (const s of bmf.scenes) {
    const nm = s.tx != null ? nameForTx.get(s.tx) : s.name
    if (nm) cueLines.push(`[${fmtLrcTime(s.t)}]${nm}`)
  }
  tracks.push({ name: 'video.cue', mimeType: 'text/plain', bytes: Array.from(new TextEncoder().encode(cueLines.join('\n') + '\n')) })
  if (tracks.every(t => /\.(cue|lrc)$/i.test(t.name))) { setStatus('None of the video’s components could be resolved on-chain.', 'error'); return }
  // The manifest mint's own cover → disc fallback (best-effort).
  let epCover: { mimeType: string; bytes: number[] } | null = null
  try { epCover = (await loadCollection(collectionId)).cover } catch { /* no cover */ }
  const lic = bmf.license != null ? `${bmf.license}${bmf.attribution ? ` — attribute ${bmf.attribution}` : ''}` : ''
  const msg = (missing === 0
    ? `✓ Block Media video resolved — ${nameForTx.size} scene component${nameForTx.size === 1 ? '' : 's'}${audioName ? ' + audio' : ''} fetched from chain and sequenced`
    : `⚠ Block Media video: ${missing} component${missing === 1 ? '' : 's'} unavailable on-chain (played without them)`)
    + (lic ? ` · Reuse: ${lic}` : '')
  const subtitle = `Block Media video · ${bmf.scenes.length} cues${lic ? ` · ${lic}` : ''}`
  showAlbumTracks(name, tracks, missing === 0 && manifest.verified, msg, subtitle, epCover)
  setStatus(msg, missing === 0 ? 'ok' : 'error')
}

async function onView(collectionId: string, collectionName: string): Promise<void> {
  setStatus('Loading the embedded file from the collection…')
  try {
    const decoded = await fetchCollectionContent(collectionId)
    if (decoded == null) { setStatus(`"${collectionName}" has no embedded file.`, 'info'); return }
    // A Block Media Format manifest references on-chain components (audio + scene clips) — resolve + play as video.
    if (isBmf(decoded.mimeType, decoded.bytes)) { await viewBmf(collectionId, collectionName, decoded); return }
    // A reference manifest points at other works instead of embedding bytes — resolve + play them as an album.
    if (isManifest(decoded.mimeType, decoded.bytes)) { await viewReferenceManifest(collectionId, collectionName, decoded); return }
    showFile(collectionName, { mimeType: decoded.mimeType, fileName: decoded.fileName, fileBytes: decoded.bytes }, decoded.verified, decoded.msg)
    setStatus(decoded.msg, decoded.verified ? 'ok' : 'error')
  } catch (e) {
    setStatus(`View failed: ${(e as Error).message}`, 'error')
  }
}

/** Resolve a reference-manifest collection: fetch each referenced work's content, hash-check it against what
 *  the manifest committed, and play the lot as one album. A reference that's unavailable or hash-mismatched is
 *  skipped (shown in the status) rather than failing the whole release. A referenced album is flattened. */
async function viewReferenceManifest(collectionId: string, epName: string, manifest: DecodedContent): Promise<void> {
  const refs = parseManifest(manifest.bytes)
  if (refs == null) { setStatus('This release references other works, but its manifest is unreadable.', 'error'); return }
  setStatus(`Resolving ${refs.length} referenced ${refs.length === 1 ? 'work' : 'works'}…`)
  const tracks: AlbumTrack[] = []
  let missing = 0
  for (const r of refs) {
    let decoded: DecodedContent | null = null
    try { decoded = await fetchCollectionContent(r.id) } catch { decoded = null }
    // Integrity: the resolved content must hash to what the EP author committed in the manifest.
    if (decoded == null || Utils.toHex(Hash.sha256(decoded.bytes)) !== r.hash) { missing++; continue }
    const inner = isAlbum(decoded.mimeType, decoded.bytes) ? parseAlbum(decoded.bytes) : null
    if (inner != null && inner.length > 0) for (const t of inner) tracks.push(t)
    else tracks.push({ name: r.name || decoded.fileName, mimeType: decoded.mimeType, bytes: decoded.bytes })
  }
  if (tracks.length === 0) { setStatus('None of the referenced works could be resolved on-chain.', 'error'); return }
  // The EP's own cover (lightweight template+storefront load) → disc fallback for any track lacking embedded art.
  let epCover: { mimeType: string; bytes: number[] } | null = null
  try { epCover = (await loadCollection(collectionId)).cover } catch { /* no cover — tracks fall back to no art */ }
  const ok = missing === 0 && manifest.verified
  const msg = missing === 0
    ? `✓ ${tracks.length} track${tracks.length === 1 ? '' : 's'} resolved from referenced mints — each hash-verified against the manifest`
    : `⚠ ${tracks.length} of ${refs.length} referenced works resolved (${missing} unavailable or hash-mismatched)`
  showAlbumTracks(epName, tracks, ok, msg, `${tracks.length} track${tracks.length === 1 ? '' : 's'} · referenced`, epCover)
  setStatus(msg, missing === 0 ? 'ok' : 'error')
}

// Object URLs for unpacked album tracks + the live player's teardown — released when the viewer
// re-renders or closes (stops the animation loop, audio, and AudioContext; revokes the blob URLs).
let albumUrls: string[] = []
let epTeardown: (() => void) | null = null
// Visualization preference (persists across tracks/sessions): the disc either SPINS (default) or, in "speaker"
// mode, stays still and pushes in/out with the bass — a no-rotation option for anyone the spinning makes dizzy.
let epVizSpeaker: boolean = (() => { try { return localStorage.getItem('pharlap:viz') === 'speaker' } catch { return false } })()
function revokeAlbumUrls(): void {
  if (epTeardown) { try { epTeardown() } catch { /* ignore */ } epTeardown = null }
  for (const u of albumUrls) URL.revokeObjectURL(u)
  albumUrls = []
}

interface SceneTimeline { scenes: { t: number; url: string }[] }
interface PlayerTrack { name: string; mimeType: string; url: string; discUrls: string[]; coverUrls: string[]; lyrics: ParsedLyrics | null; timeline: SceneTimeline | null }

/** Render one or more tracks (a packed album, or a single audio file) as the "Ethereal" EP player —
 *  spinning disc, circular audio visualizer, reactive background orbs, playlist, seek, prev/play/next,
 *  volume. Plays the in-memory tracks; non-audio files are offered as downloads below. A packed .cue/.lrc
 *  file ([mm:ss.xx]scene.webp lines) drives a scene-timeline "music video" synced to playback. Ported
 *  (scoped ep-) from the MusicPlayer-test player. */
function renderPlayer(host: HTMLElement, srcTracks: AlbumTrack[], fallbackCover?: { mimeType: string; bytes: number[] } | null): void {
  if (srcTracks.length === 0) { host.textContent = 'This release has no playable content.'; return }
  // A release-level cover (e.g. an EP's own art) shown on the disc for any track that carries no embedded art.
  let fallbackArtUrl: string | null = null
  if (fallbackCover != null && fallbackCover.bytes.length > 0) {
    fallbackArtUrl = URL.createObjectURL(new Blob([new Uint8Array(fallbackCover.bytes)], { type: fallbackCover.mimeType || 'image/jpeg' }))
    albumUrls.push(fallbackArtUrl)
  }
  const stripExt = (n: string): string => n.replace(/\.[^./\\]+$/, '')
  const baseName = (n: string): string => stripExt(n).replace(/^.*[/\\]/, '').toLowerCase()

  // Scene-timeline "videos": a packed .cue/.lrc file whose lines are [mm:ss.xx]scene-file.webp maps song time to
  // a scene image (each typically an animated WebP at its own fps). The player swaps the visible scene by playback
  // time → a seekable, audio-synced music video. Reuses the LRC engine (parseLyrics): the "text" is the filename.
  const cueFiles = srcTracks.filter(t => /\.(cue|lrc)$/i.test(t.name))
  const availNames = srcTracks.map(s => s.name)
  const cueSceneNames = new Set<string>() // packed files used as scenes (kept out of the downloads list)
  const sceneUrlByName = new Map<string, string>()
  const sceneUrlFor = (name: string): string => { // name is an actual srcTracks name (resolveCue matched it)
    const key = name.toLowerCase()
    let u = sceneUrlByName.get(key)
    if (u == null) {
      const f = srcTracks.find(s => s.name === name)!
      u = URL.createObjectURL(new Blob([new Uint8Array(f.bytes)], { type: f.mimeType || 'image/webp' }))
      albumUrls.push(u); sceneUrlByName.set(key, u); cueSceneNames.add(key)
    }
    return u
  }
  const buildTimeline = (cueBytes: number[]): SceneTimeline | null => {
    const resolved = resolveCue(new TextDecoder().decode(new Uint8Array(cueBytes)), availNames)
    return resolved == null ? null : { scenes: resolved.map(s => ({ t: s.t, url: sceneUrlFor(s.name) })) }
  }
  const cueTimelines = cueFiles.map(c => ({ base: baseName(c.name), tl: buildTimeline(c.bytes) })).filter(c => c.tl != null)

  const tracks: PlayerTrack[] = srcTracks.map(t => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(t.bytes)], { type: t.mimeType }))
    albumUrls.push(url)
    // Embedded cover art (FLAC PICTURE blocks / MP3 ID3 APIC frames — e.g. front + back cover added in Kid3)
    // → object URLs for a slideshow on the disc.
    const isFlac = t.mimeType.includes('flac') || /\.flac$/i.test(t.name)
    const isMp3 = t.mimeType.includes('mpeg') || t.mimeType.includes('mp3') || /\.mp3$/i.test(t.name)
    // Embedded pictures by type (APIC/PICTURE picture-type byte): 3 = Front, 4 = Back, 6 = Media (the CD's
    // label side). The spinning DISC shows the "Media" art when present (a moving record label), else the front;
    // the 🖼️ cover view shows the Front+Back sleeve. So you can embed a static front cover AND an animated Media
    // image without the disc cross-fading between them.
    const pics: { pictureType: number; mimeType: string; data: number[] }[] = isFlac ? parseFlacPictures(t.bytes) : isMp3 ? parseId3Pictures(t.bytes) : []
    const picUrls = pics.map(p => {
      const u = URL.createObjectURL(new Blob([new Uint8Array(p.data)], { type: p.mimeType || 'image/jpeg' }))
      albumUrls.push(u); return { type: p.pictureType, url: u }
    })
    const pick = (types: number[]): string[] => picUrls.filter(p => types.includes(p.type)).map(p => p.url)
    const allArt = picUrls.map(p => p.url)
    const media = pick([6]), front = pick([3])
    let discUrls = media.length > 0 ? media : front.length > 0 ? front : allArt
    // 🖼️ cover view = a full-size slideshow of ALL the art (the animated Media plays large here too — a pseudo
    // music video), cross-fading through front/back/media. Falls back to the release cover below if empty.
    let coverUrls = allArt
    // No embedded art on this track → fall back to the release cover (e.g. the EP's own art), if any.
    if (discUrls.length === 0 && fallbackArtUrl != null) discUrls = [fallbackArtUrl]
    if (coverUrls.length === 0 && fallbackArtUrl != null) coverUrls = [fallbackArtUrl]
    // Embedded lyrics (USLT for MP3, LYRICS/UNSYNCEDLYRICS for FLAC — added in Kid3). Plain text or LRC (timed).
    const lyrics = parseLyrics(isFlac ? parseFlacLyrics(t.bytes) : isMp3 ? parseId3Lyrics(t.bytes) : null)
    return { name: t.name, mimeType: t.mimeType, url, discUrls, coverUrls, lyrics, timeline: null }
  })
  // Route only browser-PLAYABLE audio into the player; formats it can't decode (WMA/APE/DSD…) and non-audio
  // files become downloads instead of a silent dead player. canPlayType is the source of truth; when the MIME
  // is missing we trust a known-good extension and let the runtime error handler catch any remaining miss.
  const probe = document.createElement('audio')
  const GOOD_EXT = /\.(mp3|m4a|aac|mp4|opus|ogg|oga|wav|wave|aif|aiff|flac|weba)$/i
  const isAudioFile = (t: { mimeType: string; name: string }): boolean => t.mimeType.startsWith('audio/') || GOOD_EXT.test(t.name)
  const canPlayInBrowser = (t: { mimeType: string; name: string }): boolean =>
    (t.mimeType !== '' && t.mimeType !== 'application/octet-stream') ? probe.canPlayType(t.mimeType) !== '' : GOOD_EXT.test(t.name)
  const audioTracks = tracks.filter(t => isAudioFile(t) && canPlayInBrowser(t))
  // Attach a scene timeline to each audio track — matched by basename (01.cue ↔ 01.flac), else the sole cue sheet.
  for (const at of audioTracks) {
    const m = cueTimelines.find(c => c.base === baseName(at.name)) ?? (cueTimelines.length === 1 ? cueTimelines[0] : undefined)
    at.timeline = m?.tl ?? null
  }
  // Downloads exclude the cue sheet(s) + any WebP scenes they reference — those are the video, not loose files.
  const isCueOrScene = (t: PlayerTrack): boolean => /\.(cue|lrc)$/i.test(t.name) || cueSceneNames.has(t.name.toLowerCase())
  const otherTracks = tracks.filter(t => !(isAudioFile(t) && canPlayInBrowser(t)) && !isCueOrScene(t))

  const stage = document.createElement('div')
  stage.className = 'ep-stage'
  stage.innerHTML =
    '<div class="ep-orbs"><div class="ep-orb"></div><div class="ep-orb"></div><div class="ep-orb"></div></div>' +
    '<div class="ep-player">' +
      '<button class="ep-art-toggle" type="button" aria-label="Toggle cover view" title="Cover / player view" hidden>🖼️</button>' +
      '<button class="ep-lyrics-toggle" type="button" aria-label="Toggle lyrics" title="Lyrics" hidden>📝</button>' +
      '<button class="ep-video-toggle" type="button" aria-label="Toggle music video" title="Music video" hidden>🎬</button>' +
      '<button class="ep-viz-toggle" type="button" aria-label="Visualization mode" title="Visualization: spinning disc — tap for speaker (no spin)">💿</button>' +
      '<div class="ep-disc-container"><div class="ep-disc"></div><img class="ep-art" alt="cover art" />' +
        '<div class="ep-visualizer-container"><canvas class="ep-visualizer" width="280" height="280"></canvas></div>' +
        '<img class="ep-scene" alt="" />' +
        '<div class="ep-lyrics"><div class="ep-lyrics-scroll"></div></div></div>' +
      '<ul class="ep-song-list"></ul>' +
      '<div class="ep-now-playing"></div>' +
      '<div class="ep-progress-container"><div class="ep-progress-bar"></div></div>' +
      '<div class="ep-time-display"><span class="ep-cur">0:00</span><span class="ep-dur">0:00</span></div>' +
      '<div class="ep-controls">' +
        '<button class="ep-control-btn ep-prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>' +
        '<button class="ep-control-btn ep-play-btn" aria-label="Play / pause"><svg viewBox="0 0 24 24" class="ep-play-icon"><path d="M8 5v14l11-7z"/></svg></button>' +
        '<button class="ep-control-btn ep-next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>' +
      '</div>' +
      '<div class="ep-volume-container"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>' +
        '<input type="range" class="ep-volume-slider" min="0" max="1" step="0.01" value="0.7" aria-label="Volume"></div>' +
    '</div>'
  host.append(stage)

  const q = <T extends Element>(sel: string): T => stage.querySelector(sel) as T
  const songList = q<HTMLUListElement>('.ep-song-list')
  const disc = q<HTMLElement>('.ep-disc')
  const discContainer = q<HTMLElement>('.ep-disc-container')
  const vizToggle = q<HTMLElement>('.ep-viz-toggle')
  const nowPlaying = q<HTMLElement>('.ep-now-playing')
  const progressBar = q<HTMLElement>('.ep-progress-bar')
  const progressContainer = q<HTMLElement>('.ep-progress-container')
  const curEl = q<HTMLElement>('.ep-cur'), durEl = q<HTMLElement>('.ep-dur')
  const playIcon = q<SVGElement>('.ep-play-icon')
  const canvas = q<HTMLCanvasElement>('.ep-visualizer')
  const cctx = canvas.getContext('2d')!
  const orbs = Array.from(stage.querySelectorAll('.ep-orb')) as HTMLElement[]
  const volume = q<HTMLInputElement>('.ep-volume-slider')

  const audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = parseFloat(volume.value)
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let dataArray: Uint8Array<ArrayBuffer> | null = null
  let rafId = 0, isPlaying = false, current = 0, tornDown = false
  let speakerScale = 1 // visualization: disc pulse amount in "speaker" mode (set per-frame); 1 = at rest

  // Embedded cover art on the disc — slideshow (cross-fade) if a track carries more than one picture.
  // The 🖼️/💿 toggle (shown only when art exists) flips between the player view and a full, uncropped cover view.
  const art = q<HTMLImageElement>('.ep-art')
  const player = q<HTMLElement>('.ep-player')
  const artToggle = q<HTMLElement>('.ep-art-toggle')
  let artTimer = 0
  let curDisc: string[] = [], curCover: string[] = [] // the current track's two art sets (disc = Media, cover = Front+Back)
  function runArtSlideshow(urls: string[]): void {
    window.clearInterval(artTimer)
    if (urls.length === 0) { art.style.display = 'none'; art.style.opacity = '0'; return }
    let i = 0
    art.style.display = 'block'; art.src = urls[0]; art.style.opacity = '1'
    if (urls.length > 1) {
      artTimer = window.setInterval(() => {
        i = (i + 1) % urls.length
        art.style.opacity = '0'
        window.setTimeout(() => { art.src = urls[i]; art.style.opacity = '1' }, 400)
      }, 6000)
    }
  }
  /** Load the current track's two art sets and show the one for the active view (💿 disc = Media, 🖼️ = Front+Back). */
  function showArt(disc: string[], cover: string[]): void {
    curDisc = disc; curCover = cover
    const hasAny = disc.length > 0 || cover.length > 0
    player.classList.toggle('has-art', hasAny)
    if (!hasAny) { player.classList.remove('art-view'); runArtSlideshow([]); return }
    const inCover = player.classList.contains('art-view')
    runArtSlideshow(inCover ? (cover.length > 0 ? cover : disc) : (disc.length > 0 ? disc : cover))
  }
  artToggle.onclick = () => {
    const inCover = player.classList.toggle('art-view')
    artToggle.textContent = inCover ? '💿' : '🖼️'
    runArtSlideshow(inCover ? (curCover.length > 0 ? curCover : curDisc) : (curDisc.length > 0 ? curDisc : curCover))
  }

  // Visualization mode: spinning disc (default) vs "speaker" (no spin; the disc pushes in/out with the bass).
  // Defined here — after `player`/`vizToggle`/`discContainer` exist — and called once to apply the saved pref.
  const applyViz = (): void => {
    player.classList.toggle('viz-speaker', epVizSpeaker)
    vizToggle.textContent = epVizSpeaker ? '🔊' : '💿'
    vizToggle.title = epVizSpeaker ? 'Visualization: speaker — tap for spinning disc' : 'Visualization: spinning disc — tap for speaker (no spin)'
    if (!epVizSpeaker) { discContainer.style.transform = ''; speakerScale = 1 } // back to disc mode → drop the pulse transform
  }
  vizToggle.onclick = () => {
    epVizSpeaker = !epVizSpeaker
    try { localStorage.setItem('pharlap:viz', epVizSpeaker ? 'speaker' : 'disc') } catch { /* private mode — session only */ }
    applyViz()
  }
  applyViz()

  // Lyrics overlay — a scrim-backed text layer over the disc/cover (shows through to the art behind). The 📝
  // toggle appears only when the current track carries lyrics. Synced (LRC) lyrics highlight + auto-scroll the
  // active line in time with playback; plain lyrics just scroll. Independent of the cover/disc view.
  const lyricsToggle = q<HTMLElement>('.ep-lyrics-toggle')
  const lyricsScroll = q<HTMLElement>('.ep-lyrics-scroll')
  let lyrics: ParsedLyrics | null = null
  let lyricEls: HTMLElement[] = []
  let lastLyric = -1
  function loadLyrics(parsed: ParsedLyrics | null): void {
    lyrics = parsed; lastLyric = -1; lyricEls = []; lyricsScroll.innerHTML = ''; lyricsScroll.scrollTop = 0
    if (parsed == null) { lyricsToggle.hidden = true; player.classList.remove('lyrics-view'); return }
    lyricsScroll.classList.toggle('ep-ly-synced', parsed.synced)
    for (const ln of parsed.lines) {
      const p = document.createElement('p')
      p.className = 'ep-ly-line'
      p.textContent = ln.text !== '' ? ln.text : '♪'
      lyricsScroll.append(p); lyricEls.push(p)
    }
    lyricsToggle.hidden = false
  }
  function syncLyrics(): void {
    if (lyrics == null || !lyrics.synced || lyricEls.length === 0) return
    const ct = audio.currentTime
    let idx = -1
    for (let i = 0; i < lyrics.lines.length; i++) { if (lyrics.lines[i].t <= ct) idx = i; else break }
    if (idx === lastLyric) return
    if (lastLyric >= 0 && lyricEls[lastLyric] != null) lyricEls[lastLyric].classList.remove('active')
    lastLyric = idx
    if (idx < 0) return
    const el = lyricEls[idx]
    el.classList.add('active')
    if (player.classList.contains('lyrics-view')) lyricsScroll.scrollTop = el.offsetTop - lyricsScroll.clientHeight / 2 + el.clientHeight / 2
  }
  lyricsToggle.onclick = () => {
    const on = player.classList.toggle('lyrics-view')
    lyricsToggle.textContent = on ? '✖️' : '📝'
    if (on && lastLyric >= 0 && lyricEls[lastLyric] != null) lyricsScroll.scrollTop = lyricEls[lastLyric].offsetTop - lyricsScroll.clientHeight / 2
  }

  // Scene-timeline "music video" — the 🎬 toggle (shown only when the current track has a cue sheet) enters video
  // view: the scene image fills the disc area and swaps by playback time, so it stays synced through seeks/pauses
  // (lyrics can overlay on top). Same active-index drive as the lyrics.
  const videoToggle = q<HTMLElement>('.ep-video-toggle')
  const scene = q<HTMLImageElement>('.ep-scene')
  // Size the video view to the clip's real aspect ratio (square, 16:9, whatever) so it uses the largest
  // available space instead of being centre-cropped into a fixed 1:1 box.
  scene.onload = (): void => {
    if (scene.naturalWidth > 0 && scene.naturalHeight > 0) player.style.setProperty('--ep-vid-ar', (scene.naturalWidth / scene.naturalHeight).toFixed(4))
  }
  let timeline: SceneTimeline | null = null
  let lastScene = -1
  function loadTimeline(tl: SceneTimeline | null): void {
    timeline = tl; lastScene = -1; scene.removeAttribute('src'); player.style.removeProperty('--ep-vid-ar')
    if (tl == null) { videoToggle.hidden = true; player.classList.remove('video-view'); return }
    videoToggle.hidden = false
  }
  function syncScene(): void {
    if (timeline == null || timeline.scenes.length === 0) return
    const ct = audio.currentTime
    let idx = 0
    for (let i = 0; i < timeline.scenes.length; i++) { if (timeline.scenes[i].t <= ct) idx = i; else break }
    if (idx === lastScene) return
    lastScene = idx
    scene.src = timeline.scenes[idx].url
  }
  videoToggle.onclick = () => {
    const on = player.classList.toggle('video-view')
    videoToggle.textContent = on ? '✖️' : '🎬'
    if (on) { lastScene = -1; syncScene() } // paint the current scene immediately (works while paused too)
  }

  // Lazy "Downloads" list under the player — for non-audio files and any track the browser can't play.
  let dlBox: HTMLElement | null = null
  const dlAdded = new Set<string>()
  const addDownload = (t: { name: string; url: string }, note?: string): void => {
    if (dlAdded.has(t.url)) return
    dlAdded.add(t.url)
    if (dlBox == null) {
      dlBox = document.createElement('div'); dlBox.className = 'ep-downloads'
      const lbl = document.createElement('div'); lbl.className = 'ep-dl-label'; lbl.textContent = 'Downloads'
      dlBox.append(lbl); host.append(dlBox)
    }
    const a = document.createElement('a')
    a.href = t.url; a.download = t.name; a.className = 'viewer-dl'
    a.textContent = `Download ${t.name}${note ? ` — ${note}` : ''}`
    dlBox.append(a)
  }

  const fmt = (s: number): string => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00'

  function initAudioContext(): void {
    if (audioCtx) return
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new AC()
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 256
      audioCtx.createMediaElementSource(audio).connect(analyser)
      analyser.connect(audioCtx.destination)
      dataArray = new Uint8Array(analyser.frequencyBinCount)
    } catch { /* the visualizer is best-effort; audio still plays without it */ }
  }
  const updatePlayIcon = (): void => { playIcon.innerHTML = isPlaying ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>' }
  function updateProgress(): void {
    if (audio.duration) progressBar.style.width = `${(audio.currentTime / audio.duration) * 100}%`
    curEl.textContent = fmt(audio.currentTime)
    syncLyrics()
    syncScene()
  }
  function play(i: number): void {
    if (audioTracks.length === 0) return
    current = ((i % audioTracks.length) + audioTracks.length) % audioTracks.length
    Array.from(songList.children).forEach((li, k) => li.classList.toggle('active', k === current))
    initAudioContext(); void audioCtx?.resume()
    audio.src = audioTracks[current].url
    showArt(audioTracks[current].discUrls, audioTracks[current].coverUrls)
    loadLyrics(audioTracks[current].lyrics)
    loadTimeline(audioTracks[current].timeline)
    nowPlaying.innerHTML = `Now playing: <span>${escapeHtml(stripExt(audioTracks[current].name))}</span>`
    void audio.play().catch(() => { nowPlaying.textContent = 'Tap a track to play' })
  }

  audioTracks.forEach((t, i) => {
    const li = document.createElement('li'); li.textContent = stripExt(t.name)
    li.onclick = () => play(i)
    songList.append(li)
  })
  audio.addEventListener('timeupdate', updateProgress)
  audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(audio.duration) })
  audio.addEventListener('play', () => { isPlaying = true; disc.classList.add('playing'); player.classList.add('playing'); updatePlayIcon() })
  audio.addEventListener('pause', () => { isPlaying = false; disc.classList.remove('playing'); player.classList.remove('playing'); updatePlayIcon() })
  audio.addEventListener('ended', () => play(current + 1))
  audio.addEventListener('error', () => {
    if (tornDown || !audio.src) return // ignore the error fired when src is cleared on teardown
    const t = audioTracks[current]
    if (t == null) return
    nowPlaying.innerHTML = `<span>Can’t play “${escapeHtml(stripExt(t.name))}” in this browser — download it below.</span>`
    addDownload(t, 'unsupported format')
  })

  q<HTMLElement>('.ep-prev').onclick = () => play(current - 1)
  q<HTMLElement>('.ep-next').onclick = () => play(current + 1)
  q<HTMLElement>('.ep-play-btn').onclick = () => {
    if (!audio.src) { play(0); return }
    if (isPlaying) audio.pause(); else { void audioCtx?.resume(); void audio.play() }
  }
  progressContainer.onclick = (e: MouseEvent) => {
    if (!audio.duration) return
    const r = progressContainer.getBoundingClientRect()
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration
  }
  volume.oninput = () => { audio.volume = parseFloat(volume.value) }

  // Reactive orbs + circular bars — one rAF loop, both best-effort (no analyser ⇒ static).
  function frame(): void {
    rafId = requestAnimationFrame(frame)
    let bassNow = 0
    if (analyser != null && isPlaying && dataArray != null) {
      analyser.getByteFrequencyData(dataArray)
      let bass = 0, mids = 0, highs = 0
      for (let i = 0; i < 10; i++) bass += dataArray[i]
      for (let i = 10; i < 40; i++) mids += dataArray[i]
      for (let i = 40; i < 80; i++) highs += dataArray[i]
      bass /= 10 * 255; mids /= 30 * 255; highs /= 40 * 255
      bassNow = bass
      const t = Date.now()
      orbs[0].style.transform = `translate(${Math.sin(t / 1000) * 30 * bass}px, ${Math.cos(t / 1200) * 30 * bass}px) scale(${1 + bass * 0.5})`
      orbs[0].style.opacity = `${0.4 + bass * 0.4}`
      orbs[1].style.transform = `translate(${Math.cos(t / 1100) * 40 * mids}px, ${Math.sin(t / 900) * 40 * mids}px) scale(${1 + mids * 0.4})`
      orbs[1].style.opacity = `${0.4 + mids * 0.4}`
      orbs[2].style.transform = `translate(calc(-50% + ${Math.sin(t / 800) * 50 * highs}px), calc(-50% + ${Math.cos(t / 1000) * 50 * highs}px)) scale(${1 + highs * 0.3})`
      orbs[2].style.opacity = `${0.4 + highs * 0.5}`
    }
    // Speaker mode: the disc pushes in/out with the bass (eased so it pumps rather than jitters; rests at scale 1).
    // Only in the normal disc view — not the full cover or video views (which resize the container themselves).
    if (player.classList.contains('viz-speaker') && !player.classList.contains('art-view') && !player.classList.contains('video-view')) {
      speakerScale += ((1 + bassNow * 0.3) - speakerScale) * 0.35
      discContainer.style.transform = `scale(${speakerScale.toFixed(3)})`
    } else if (speakerScale !== 1) {
      speakerScale = 1; discContainer.style.transform = ''
    }
    cctx.clearRect(0, 0, canvas.width, canvas.height)
    if (analyser != null && isPlaying && dataArray != null) {
      const cx = canvas.width / 2, cy = canvas.height / 2, radius = 95, bars = 64
      for (let i = 0; i < bars; i++) {
        const h = (dataArray[i] / 255) * 42
        const a = (i / bars) * Math.PI * 2 - Math.PI / 2
        const x1 = cx + Math.cos(a) * radius, y1 = cy + Math.sin(a) * radius
        const x2 = cx + Math.cos(a) * (radius + h), y2 = cy + Math.sin(a) * (radius + h)
        const g = cctx.createLinearGradient(x1, y1, x2, y2)
        g.addColorStop(0, 'rgba(255,0,110,0.85)'); g.addColorStop(0.5, 'rgba(131,56,236,0.85)'); g.addColorStop(1, 'rgba(58,134,255,0.85)')
        cctx.beginPath(); cctx.moveTo(x1, y1); cctx.lineTo(x2, y2)
        cctx.strokeStyle = g; cctx.lineWidth = 3; cctx.lineCap = 'round'; cctx.stroke()
      }
    }
  }
  frame()

  if (audioTracks.length > 0) {
    (songList.children[0] as HTMLElement).classList.add('active')
    nowPlaying.textContent = 'Tap a track to play'
    showArt(audioTracks[0].discUrls, audioTracks[0].coverUrls) // show the first track's cover up front, before playback
    loadLyrics(audioTracks[0].lyrics) // surface the 📝 toggle before playback if the first track has lyrics
    loadTimeline(audioTracks[0].timeline) // surface the 🎬 toggle if the first track has a scene timeline
  } else {
    nowPlaying.textContent = otherTracks.some(isAudioFile) ? 'No in-browser-playable audio — see downloads below.' : 'This release has no playable audio.'
  }

  // Non-audio files (artwork, liner notes…) and any unplayable audio → downloads under the player.
  for (const t of otherTracks) addDownload(t, isAudioFile(t) ? 'can’t play in this browser' : undefined)

  epTeardown = () => {
    tornDown = true
    cancelAnimationFrame(rafId)
    window.clearInterval(artTimer)
    try { audio.pause() } catch { /* ignore */ }
    audio.src = ''
    try { void audioCtx?.close() } catch { /* ignore */ }
  }
}

function showFile(title: string, file: { mimeType: string; fileName: string; fileBytes: number[] }, verified: boolean, note?: string): void {
  const content = $('viewerContent')
  revokeAlbumUrls()
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  viewerUrl = URL.createObjectURL(new Blob([new Uint8Array(file.fileBytes)], { type: file.mimeType }))
  $('viewerTitle').textContent =
    `${title} — ${file.fileName} · ${file.mimeType} · ${file.fileBytes.length} bytes`
  const banner = $('viewerProvenance')
  if (note) {
    banner.textContent = note
    banner.className = `viewer-banner ${verified ? 'ok' : 'error'}`
    banner.style.display = 'block'
  } else {
    banner.style.display = 'none'
  }
  content.innerHTML = ''
  // An album unpacks to many tracks; a lone audio file plays as a one-track release — both get the player.
  const albumTracks = isAlbum(file.mimeType, file.fileBytes) ? parseAlbum(file.fileBytes) : null
  if (albumTracks != null) {
    renderPlayer(content, albumTracks)
  } else if (file.mimeType.startsWith('audio/')) {
    renderPlayer(content, [{ name: file.fileName, mimeType: file.mimeType, bytes: file.fileBytes }])
  } else if (file.mimeType.startsWith('image/')) {
    const img = document.createElement('img')
    img.src = viewerUrl
    img.className = 'viewer-img'
    content.append(img)
  } else if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json') {
    const pre = document.createElement('pre')
    pre.className = 'viewer-pre'
    pre.textContent = new TextDecoder().decode(new Uint8Array(file.fileBytes))
    content.append(pre)
  } else {
    const a = document.createElement('a')
    a.href = viewerUrl
    a.download = file.fileName
    a.textContent = `Download ${file.fileName}`
    a.className = 'viewer-dl'
    content.append(a)
  }
  $('viewer').style.display = 'flex'
}

/** Open the viewer on a set of already-resolved tracks (used by reference-manifest playback — the tracks
 *  come from other collections, so there's no single file blob). Mirrors showFile's album branch. */
function showAlbumTracks(title: string, tracks: AlbumTrack[], verified: boolean, note: string, subtitle: string, fallbackCover?: { mimeType: string; bytes: number[] } | null): void {
  const content = $('viewerContent')
  revokeAlbumUrls()
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  $('viewerTitle').textContent = `${title} — ${subtitle}`
  const banner = $('viewerProvenance')
  if (note) { banner.textContent = note; banner.className = `viewer-banner ${verified ? 'ok' : 'error'}`; banner.style.display = 'block' }
  else banner.style.display = 'none'
  content.innerHTML = ''
  renderPlayer(content, tracks, fallbackCover)
  $('viewer').style.display = 'flex'
}

function closeViewer(): void {
  $('viewer').style.display = 'none'
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  revokeAlbumUrls()
  $('viewerContent').innerHTML = ''
}

// ─── token list ─────────────────────────────────────────────────────
// MIME → display category. Ordered; each held collection lands in exactly one collapsible section.
type Cat = 'image' | 'audio' | 'video' | 'document' | 'text' | 'archive' | 'other'
const CATS: { key: Cat; label: string; icon: string }[] = [
  { key: 'image', label: 'Images', icon: '🖼️' },
  { key: 'audio', label: 'Audio', icon: '🎵' },
  { key: 'video', label: 'Video', icon: '🎬' },
  { key: 'document', label: 'Documents', icon: '📄' },
  { key: 'text', label: 'Text', icon: '📝' },
  { key: 'archive', label: 'Archives', icon: '🗜️' },
  { key: 'other', label: 'Other', icon: '🎴' },
]
function mimeCategory(mime: string | null): Cat {
  if (mime == null || mime === '') return 'other'
  const m = mime.toLowerCase()
  if (m === ALBUM_MIME) return 'audio' // a packed album is a music release
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('text/')) return 'text'
  if (m === 'application/pdf' || m.includes('msword') || m.includes('officedocument') || m.includes('ms-excel') ||
      m.includes('ms-powerpoint') || m.includes('opendocument') || m === 'application/rtf' || m === 'application/epub+zip') return 'document'
  if (m === 'application/json' || m === 'application/xml' || m.endsWith('+xml')) return 'text'
  if (m === 'application/zip' || m === 'application/gzip' || m === 'application/x-tar' || m.includes('compressed') ||
      m.includes('7z') || m.includes('rar') || m === 'application/x-bzip2') return 'archive'
  return 'other'
}

function renderTokens(skipWarm = false): void {
  const host = $('tokens')
  // Newest first by acquisition height (unconfirmed/unknown = newest), so the order is meaningful even
  // after a bulk from-chain recovery (where insertion order is scan order, not chronological). Tiebreak
  // by addedAt so freshly minted/received tokens stay on top.
  const active = [...store.active()].sort((a, b) => {
    const ha = a.heightHint ?? Infinity
    const hb = b.heightHint ?? Infinity
    if (ha !== hb) return hb - ha
    return (b.addedAt ?? '').localeCompare(a.addedAt ?? '')
  })
  if (active.length === 0) { host.innerHTML = '<p class="muted">No NFTs yet. Publish a collection or Check Incoming.</p>'; return }
  const myHash = myPubKeyHash()
  // Group identical holdings (same collection = interchangeable copies/editions), preserving sort order
  // by first appearance. A single copy renders as a normal card; multiples collapse into one group card.
  const groups = new Map<string, StoredToken[]>()
  for (const t of active) {
    const g = groups.get(t.collectionId)
    if (g != null) g.push(t); else groups.set(t.collectionId, [t])
  }
  if (nftSort === 'publisher') { renderTokensByPublisher(host, active, groups, myHash); return }
  // Bucket each collection by content type. A collection whose MIME isn't cached yet sits in a temporary
  // "identifying…" section until the metadata fetch warms the cache (then we re-render once). On the warm
  // re-render (skipWarm) any still-unresolved collection has failed to fetch — show it under Other.
  const buckets = new Map<Cat | 'pending', Array<[string, StoredToken[]]>>()
  let anyPending = false
  for (const [collectionId, copies] of groups) {
    const mime = cachedMime(collectionId)
    const cat: Cat | 'pending' = mime === undefined ? (skipWarm ? 'other' : (anyPending = true, 'pending')) : mimeCategory(mime)
    const arr = buckets.get(cat); if (arr != null) arr.push([collectionId, copies]); else buckets.set(cat, [[collectionId, copies]])
  }

  host.innerHTML = `<p class="muted" style="font-size:12px;margin:0 0 8px">${active.length} held — newest first</p>`
  const single = CATS.filter(c => buckets.get(c.key)?.length).length <= 1 && !anyPending
  for (const c of CATS) {
    const items = buckets.get(c.key)
    if (items == null || items.length === 0) continue
    // With only one type present, skip the section chrome — a lone header adds nothing.
    if (single) host.append(sectionBody(items, myHash))
    else host.append(sectionEl(`${c.icon} ${c.label}`, items, myHash))
  }
  const pending = buckets.get('pending')
  if (pending?.length) host.append(sectionEl('⏳ Identifying type…', pending, myHash))

  if (anyPending) void warmAndRerender([...groups.keys()])
  // Watch-only skips publisher-identity/avatar resolution: that path scans each publisher's full address
  // history (a busy publisher → many large content-mint txs) and drives a resolve→re-render cycle that can
  // hang the page. A monitoring view doesn't need publisher names/avatars — cards show identicons.
  if (!isWatchOnly()) resolvePublisherIdentitiesThen(active, () => renderTokens(true))
}

/** "Sort by publisher" view: collections grouped under their publisher (avatar + @alias) instead of by type. */
function renderTokensByPublisher(host: HTMLElement, active: StoredToken[], groups: Map<string, StoredToken[]>, myHash: string): void {
  // Bucket collections by publisher: a resolved pubkey, else 'you' / 'pending' / 'none'.
  const buckets = new Map<string, Array<[string, StoredToken[]]>>()
  for (const [collectionId, copies] of groups) {
    const t0 = copies[0]
    const k = t0.publisherPubKeyHashHex == null ? 'none'
      : t0.publisherPubKeyHashHex === myHash ? 'you'
      : t0.publisherPubKeyHex ?? 'pending'
    const arr = buckets.get(k); if (arr != null) arr.push([collectionId, copies]); else buckets.set(k, [[collectionId, copies]])
  }
  // Order: your own first, then resolved publishers (by display name), then still-resolving, then publisher-less.
  const isPub = (k: string) => k !== 'you' && k !== 'pending' && k !== 'none'
  const order = [...buckets.keys()].sort((a, b) => {
    const rank = (k: string) => (k === 'you' ? 0 : isPub(k) ? 1 : k === 'pending' ? 2 : 3)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return isPub(a) ? displayName(a).name.localeCompare(displayName(b).name) : 0
  })

  host.innerHTML = `<p class="muted" style="font-size:12px;margin:0 0 8px">${active.length} held — by publisher</p>`
  for (const k of order) {
    const items = buckets.get(k)!
    const label = k === 'you' ? '📤 Published by you'
      : k === 'pending' ? '⏳ Resolving publisher…'
      : k === 'none' ? '🪙 No publisher'
      : nameChip(k)
    host.append(sectionEl(label, items, myHash))
  }
  // Watch-only skips publisher-identity/avatar resolution: that path scans each publisher's full address
  // history (a busy publisher → many large content-mint txs) and drives a resolve→re-render cycle that can
  // hang the page. A monitoring view doesn't need publisher names/avatars — cards show identicons.
  if (!isWatchOnly()) resolvePublisherIdentitiesThen(active, () => renderTokens(true))
}

function card(collectionId: string, copies: StoredToken[], myHash: string): HTMLElement {
  return copies.length === 1 ? singleCard(copies[0], myHash) : groupCard(collectionId, copies, myHash)
}

/** A section's contents, rendered per the current view: a vertical list of cards, or a wall of tiles. */
function sectionBody(items: Array<[string, StoredToken[]]>, myHash: string): HTMLElement {
  const wrap = document.createElement('div')
  if (nftView === 'grid') {
    wrap.className = 'token-grid'
    for (const [cid, copies] of items) wrap.append(tileEl(cid, copies, myHash))
  } else {
    for (const [cid, copies] of items) wrap.append(card(cid, copies, myHash))
  }
  return wrap
}

/** A collapsible type section: a clickable header (icon + label + count) over its cards/tiles. */
function sectionEl(label: string, items: Array<[string, StoredToken[]]>, myHash: string): HTMLElement {
  const sec = document.createElement('div')
  sec.className = 'token-section'
  const head = document.createElement('div')
  head.className = 'token-section-head'
  head.innerHTML = `<span class="chev">▾</span> <span class="token-section-label">${label}</span> <span class="count">${items.length}</span>`
  const bodyEl = sectionBody(items, myHash)
  bodyEl.classList.add('token-section-body')
  head.onclick = e => {
    if ((e.target as HTMLElement).closest('.copy-id, button') != null) return // let chip copy / buttons win
    bodyEl.hidden = !bodyEl.hidden
    head.querySelector('.chev')!.textContent = bodyEl.hidden ? '▸' : '▾'
  }
  sec.append(head, bodyEl)
  return sec
}

/** A grid tile for a collection group: thumbnail + name + ×N count; click opens the detail modal. */
function tileEl(collectionId: string, copies: StoredToken[], myHash: string): HTMLElement {
  const t0 = copies[0]
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'token-tile'
  const thumb = document.createElement('div')
  thumb.className = 'token-tile-thumb'
  thumb.innerHTML = '<div class="token-thumb-ph">🎴</div>'
  void fillCardThumb(thumb, collectionId)
  const cap = document.createElement('div')
  cap.className = 'token-tile-cap'
  cap.innerHTML = `<span class="token-tile-name">${escapeHtml(t0.collectionName ?? 'Collection')}</span>` +
    `${copies.length > 1 ? `<span class="count">×${copies.length}</span>` : (t0.kind === 'edition' ? '<span class="count">edition</span>' : '')}`
  tile.append(thumb, cap)
  tile.onclick = () => openTokenDetail(collectionId, copies, myHash)
  return tile
}

/** Open the detail modal for a collection group (the full card + actions; groups start expanded). */
function openTokenDetail(collectionId: string, copies: StoredToken[], myHash: string): void {
  const body = $('tokenModalBody')
  body.innerHTML = ''
  body.append(copies.length === 1 ? singleCard(copies[0], myHash) : groupCard(collectionId, copies, myHash, true))
  $('tokenModal').style.display = 'flex'
}

function closeTokenModal(): void {
  $('tokenModal').style.display = 'none'
  $('tokenModalBody').innerHTML = ''
}

function setNftView(v: 'list' | 'grid'): void {
  if (nftView === v) return
  nftView = v
  try { localStorage.setItem('p:nftview', v) } catch { /* fine */ }
  updateViewToggle()
  renderTokens()
}

function setNftSort(s: 'recent' | 'publisher'): void {
  if (nftSort === s) return
  nftSort = s
  try { localStorage.setItem('p:nftsort', s) } catch { /* fine */ }
  updateSortToggle()
  renderTokens()
}

function updateSortToggle(): void {
  $('btnSortRecent').classList.toggle('active', nftSort === 'recent')
  $('btnSortPublisher').classList.toggle('active', nftSort === 'publisher')
}

function updateViewToggle(): void {
  $('btnViewList').classList.toggle('active', nftView === 'list')
  $('btnViewGrid').classList.toggle('active', nftView === 'grid')
}

/** Warm the MIME/thumbnail cache for all held collections, then re-render once so they settle into sections. */
async function warmAndRerender(collectionIds: string[]): Promise<void> {
  await Promise.all(collectionIds.map(ensureCollectionMeta))
  renderTokens(true)
}

/** A card thumbnail element (placeholder, then filled async from the collection's public cover/image). */
function tokenThumbEl(collectionId: string): HTMLElement {
  const thumb = document.createElement('div')
  thumb.className = 'token-thumb'
  thumb.innerHTML = '<div class="token-thumb-ph">🎴</div>'
  void fillCardThumb(thumb, collectionId)
  return thumb
}

/** Per-copy extra lines (state, seller note, bonus, latest broadcast) as HTML. */
function tokenExtrasHtml(t: StoredToken): string {
  const stateText = t.stateData && t.stateData !== '00' ? safeUtf8(t.stateData) : ''
  const latest = latestBroadcast.get(t.collectionId)
  return `${stateText ? `<div class="state">state: ${escapeHtml(stateText)}</div>` : ''}` +
    `${t.sellerNote ? `<div class="state" style="color:var(--accent2)">📝 ${escapeHtml(t.sellerNote)}</div>` : ''}` +
    `${t.bonusValue ? (t.bonusKind === 'link'
      ? `<div class="state">🎁 <a href="${escapeHtml(t.bonusValue)}" target="_blank" rel="noopener" class="bonus-claim">Claim your bonus ↗</a></div>`
      : `<div class="state">🎁 Bonus code: <span class="mono">${escapeHtml(t.bonusValue)}</span></div>`) : ''}` +
    `${latest ? `<div class="state" style="color:var(--accent)">📣 ${escapeHtml(latest.text)}</div>` : ''}`
}

/** Publisher-only: publish a PUBLIC "listen before you buy" preview clip for a collection. The publisher uploads
 *  a finished mp3 (trimmed in their DAW); it's posted on-chain under their key so the sales page + nft.sale can
 *  play it to prospective buyers. Latest published wins. PHAR LAP does not trim/transcode — upload only. */
async function onPublishPreview(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  const name = t.collectionName ?? 'this collection'
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/mpeg,.mp3'
  input.onchange = async () => {
    const clip = await readFile(input)
    if (!clip) return
    const kb = Math.round(clip.bytes.length / 1024)
    if (clip.bytes.length > MAX_PREVIEW_BYTES) {
      setStatus(`Preview too large (${kb} KB; max ${Math.round(MAX_PREVIEW_BYTES / 1024)} KB). Use a shorter or lower-bitrate mp3.`, 'error'); return
    }
    if (!confirm(`Publish a ${kb} KB preview clip for “${name}”?\n\nIt's posted on-chain (a small one-off fee) so anyone can listen before buying. Replaces any previous preview for this collection.`)) return
    setStatus('Publishing preview clip…')
    try {
      const txId = await publishPreview(provider, k, t.collectionId, { mimeType: clip.mimeType || 'audio/mpeg', bytes: clip.bytes })
      setStatusHtml(`🎧 Preview published ✓ — <a href="https://whatsonchain.com/tx/${txId}" target="_blank" rel="noopener">${txId.slice(0, 16)}…</a>`, 'ok')
      toast('Preview clip published ✓')
      console.info(`[preview] published ${txId} for ${t.collectionId}`)
    } catch (e) {
      setStatus(`Preview publish failed: ${(e as Error).message}`, 'error')
    }
  }
  input.click()
}

/** The per-copy action buttons (Replicate/Transfer/OPEN/Sales/Verify for editions; Send/Verify/OPEN else). */
function tokenActions(t: StoredToken, myHash: string): HTMLElement {
  const isEdition = t.kind === 'edition'
  const iAmPublisher = t.publisherPubKeyHashHex != null && t.publisherPubKeyHashHex === myHash
  const ro = isWatchOnly() // watch-only: read/explore only, no signing buttons
  const verify = document.createElement('button')
  verify.textContent = 'Verify'; verify.className = 'secondary'
  verify.onclick = () => void onVerify(t.txId, t.outputIndex)
  const actions = document.createElement('div')
  actions.className = 'actions'
  if (isEdition) {
    const view = document.createElement('button')
    view.textContent = 'OPEN'; view.className = 'secondary'
    view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Edition')
    const sales = document.createElement('button')
    sales.textContent = 'Sales page'; sales.className = 'secondary'
    sales.onclick = () => onOpenSalesPage(t)
    if (!ro) {
      const replicate = document.createElement('button')
      replicate.textContent = 'Replicate'
      replicate.onclick = () => void onReplicate(t)
      const xfer = document.createElement('button')
      xfer.textContent = 'Transfer'; xfer.className = 'secondary'
      xfer.onclick = () => void onTransferEdition(t)
      actions.append(replicate, xfer)
    }
    actions.append(view, sales, verify)
    // 🔥 Burn — only for burn-capable (bonded) editions; reclaims the bond and destroys the token.
    if (!ro && t.lockHex != null && editionSupportsBurn(Utils.toArray(t.lockHex, 'hex'))) {
      const burn = document.createElement('button')
      burn.textContent = '🔥 Burn'; burn.className = 'secondary'
      burn.onclick = () => void onBurn(t)
      actions.append(burn)
    }
    // 🎁 Gift / links / reclaim — any holder can gift (resellers too); vouchers derive from their own key.
    if (!ro) {
      const gift = document.createElement('button')
      gift.textContent = '🎁 Gift'; gift.className = 'secondary'
      gift.onclick = () => void onGiftCopies(t)
      const links = document.createElement('button')
      links.textContent = '📥 Gift links'; links.className = 'secondary'
      links.onclick = () => void onViewGiftLinks(t)
      const reclaim = document.createElement('button')
      reclaim.textContent = '♻ Reclaim gifts'; reclaim.className = 'secondary'
      reclaim.onclick = () => void onReclaimGifts(t)
      const partner = document.createElement('button')
      partner.textContent = '🤝 Onboard partner'; partner.className = 'secondary'
      partner.onclick = () => void onOnboardPartner(t)
      actions.append(gift, links, reclaim, partner)
    }
    // 📣 Broadcast + 👥 Buyers stay publisher-only (collection-wide actions).
    if (iAmPublisher) {
      if (!ro) {
        const bc = document.createElement('button')
        bc.textContent = '📣 Broadcast'; bc.className = 'secondary'
        bc.onclick = () => void onBroadcast(t)
        const prev = document.createElement('button')
        prev.textContent = '🎧 Preview clip'; prev.className = 'secondary'
        prev.onclick = () => void onPublishPreview(t)
        actions.append(bc, prev)
      }
      const buyers = document.createElement('button')
      buyers.textContent = '👥 Buyers'; buyers.className = 'secondary'
      buyers.onclick = () => void onViewBuyers(t)
      actions.append(buyers)
    }
  } else {
    const view = document.createElement('button')
    view.textContent = 'OPEN'; view.className = 'secondary'
    view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Collection')
    if (!ro) {
      const send = document.createElement('button')
      send.textContent = 'Send'
      send.onclick = () => void onSend(t.txId, t.outputIndex)
      actions.append(send)
    }
    actions.append(verify, view)
  }
  return actions
}

/** A normal single-copy card. */
function singleCard(t: StoredToken, myHash: string): HTMLElement {
  const card = document.createElement('div')
  card.className = 'token'
  const body = document.createElement('div')
  body.className = 'token-body'
  const isEdition = t.kind === 'edition'
  body.innerHTML = `
    <div class="token-name">${escapeHtml(t.collectionName ?? 'Collection')}${isEdition ? ' <span class="badge">edition</span>' : ''}</div>
    <div class="mono token-ids">collection <span class="copy-id" data-copy="${t.collectionId}" title="${t.collectionId} — click to copy">${short(t.collectionId)}</span> · utxo <span class="copy-id" data-copy="${t.txId}" title="${t.txId} — click to copy">${short(t.txId)}</span>:${t.outputIndex}</div>
    ${tokenExtrasHtml(t)}`
  const pubRow = publisherRowEl(t, myHash); if (pubRow != null) body.append(pubRow)
  body.append(tokenActions(t, myHash))
  card.append(tokenThumbEl(t.collectionId), body)
  return card
}

/** A collapsible group of identical (same-collection) copies: header + a ×N count, expanding to per-copy rows. */
function groupCard(collectionId: string, copies: StoredToken[], myHash: string, startOpen = false): HTMLElement {
  const t0 = copies[0]
  const isEdition = t0.kind === 'edition'
  const card = document.createElement('div')
  card.className = 'token token-group'
  if (startOpen) card.classList.add('open')
  const head = document.createElement('div')
  head.className = 'token-group-head'
  const headBody = document.createElement('div')
  headBody.className = 'token-body'
  headBody.innerHTML = `
    <div class="token-name">${escapeHtml(t0.collectionName ?? 'Collection')}${isEdition ? ' <span class="badge">edition</span>' : ''} <span class="count">×${copies.length}</span></div>
    <div class="mono token-ids">collection <span class="copy-id" data-copy="${collectionId}" title="${collectionId} — click to copy">${short(collectionId)}</span> · ${copies.length} copies held</div>`
  const pubRow = publisherRowEl(t0, myHash); if (pubRow != null) headBody.append(pubRow)
  const chev = document.createElement('span')
  chev.className = 'chev'; chev.textContent = startOpen ? '▾' : '▸'
  head.append(tokenThumbEl(collectionId), headBody, chev)

  const items = document.createElement('div')
  items.className = 'token-group-items'; items.hidden = !startOpen
  for (const t of copies) {
    const row = document.createElement('div')
    row.className = 'token-copy'
    row.innerHTML = `<div class="mono token-ids">utxo <span class="copy-id" data-copy="${t.txId}" title="${t.txId} — click to copy">${short(t.txId)}</span>:${t.outputIndex}</div>${tokenExtrasHtml(t)}`
    row.append(tokenActions(t, myHash))
    items.append(row)
  }
  head.onclick = e => {
    if ((e.target as HTMLElement).closest('.copy-id') != null) return // let click-to-copy win, don't toggle
    items.hidden = !items.hidden
    chev.textContent = items.hidden ? '▸' : '▾'
    card.classList.toggle('open', !items.hidden)
  }
  card.append(head, items)
  return card
}

// Per-collection card metadata (thumbnail + content MIME type) is derived from ONE TX1 fetch, deduped per
// collection and cached locally (see thumbs.ts) — never stored on-chain. The fetch runs async so the card
// list renders instantly; thumbnails fill in and the type sections settle once the cache warms.
const metaInFlight = new Map<string, Promise<void>>()

async function fillCardThumb(thumbEl: HTMLElement, collectionId: string): Promise<void> {
  const cached = cachedThumb(collectionId)
  const url = cached != null ? cached : (await ensureCollectionMeta(collectionId), cachedThumb(collectionId))
  if (url == null) return // keep the placeholder
  const img = document.createElement('img')
  img.className = 'token-thumb-img'
  img.loading = 'lazy'
  img.src = url
  thumbEl.innerHTML = ''
  thumbEl.append(img)
}

/** Resolve (and cache) a collection's thumbnail + MIME type from its TX1, deduped per collection. */
async function ensureCollectionMeta(collectionId: string): Promise<void> {
  if (thumbResolved(collectionId) && cachedMime(collectionId) !== undefined) return
  let p = metaInFlight.get(collectionId)
  if (p == null) { p = fetchCollectionMeta(collectionId); metaInFlight.set(collectionId, p) }
  try { await p } finally { metaInFlight.delete(collectionId) }
}

async function fetchCollectionMeta(collectionId: string): Promise<void> {
  try {
    const tx1 = await provider.getSourceTransaction(collectionId)
    let coverBytes: number[] | undefined
    let coverMime = 'application/octet-stream'
    let file: { mimeType: string; fileName: string; fileBytes: number[] } | null = null
    let template: TemplateFields | undefined
    for (const o of tx1.outputs) {
      const s = parseStorefrontScript(o.lockingScript)
      if (s?.fields.coverBytes?.length) { coverBytes = s.fields.coverBytes; coverMime = s.fields.coverMimeType ?? coverMime }
      const f = parseFileScript(o.lockingScript); if (f) file = f.fields
      const t = parseTemplateScript(o.lockingScript); if (t) template = t.fields
    }
    // MIME for the type sections = the embedded content file's type (null = no file). Plaintext even when
    // the bytes are encrypted, so encrypted collections still categorize.
    cacheMime(collectionId, file?.mimeType ?? null)
    // Thumbnail: prefer the public storefront cover; else a public, image-typed embedded file (decompress if needed).
    if (coverBytes?.length) { if (await makeThumb(collectionId, coverBytes, coverMime) != null) return }
    const rules = template != null ? decodeTokenRules(template.tokenRules) : null
    if (file != null && !(rules?.isEncrypted) && file.mimeType.startsWith('image/')) {
      let bytes = file.fileBytes
      if (rules?.isCompressed) { try { bytes = await decompress(bytes) } catch { /* use raw */ } }
      if (await makeThumb(collectionId, bytes, file.mimeType) != null) return
    }
    cacheNoThumb(collectionId)
  } catch {
    /* transient fetch/parse error — leave unresolved so the next render retries */
  }
}

function safeUtf8(hex: string): string {
  try { return Utils.toUTF8(Utils.toArray(hex, 'hex')) } catch { return hex }
}

// Truncated ids (collection / tx / utxo) are shown abbreviated to save space but carry the FULL value in
// data-copy, so a click copies the whole string (e.g. to paste into WhatsOnChain). One delegated listener
// handles every [data-copy] element in the app.
function onCopyClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement | null)?.closest('[data-copy]') as HTMLElement | null
  if (el == null) return
  const value = el.dataset.copy ?? ''
  if (value === '') return
  void navigator.clipboard?.writeText(value)
  toast('Copied to clipboard')
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(message: string): void {
  let el = document.getElementById('toast')
  if (el == null) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el) }
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el?.classList.remove('show'), 1400)
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// ─── aliases (self-asserted display names) ──────────────────────────
// A key names ITSELF (carried in the message/post envelope, bound to the sender pubkey). Aliases are NOT
// unique — the pubkey is the real identity (shown on hover). Your saved contacts (verified) override a
// key's self-claim; an unseen self-claim shows as "unverified" until you save it. All local, nothing extra
// on-chain beyond the envelope part.
let contacts: Record<string, string> = {} // pubkeyHex(lc) → your saved/verified alias (wins)
let contactsAt: Record<string, number> = {} // pubkeyHex(lc) → updatedAt ms (for newest-wins backup merge)
let seenAliases: Record<string, string> = {} // pubkeyHex(lc) → observed self-asserted alias (unverified)
let pinned: Record<string, 1> = {} // pubkeyHex(lc) → 1 if you set a CUSTOM label (don't auto-follow renames)

function persist(k: string, v: object): void { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota */ } }

function loadAliases(): void {
  try { contacts = JSON.parse(localStorage.getItem('p:contacts') ?? '{}') } catch { contacts = {} }
  try { contactsAt = JSON.parse(localStorage.getItem('p:contactsAt') ?? '{}') } catch { contactsAt = {} }
  try { seenAliases = JSON.parse(localStorage.getItem('p:aliases') ?? '{}') } catch { seenAliases = {} }
  try { pinned = JSON.parse(localStorage.getItem('p:pinned') ?? '{}') } catch { pinned = {} }
  try { avatars = JSON.parse(localStorage.getItem('p:avatars') ?? '{}') } catch { avatars = {} }
}
function getMyAlias(): string { try { return (localStorage.getItem('p:myalias') ?? '').trim() } catch { return '' } }
function setMyAlias(a: string): void {
  try { localStorage.setItem('p:myalias', a); localStorage.setItem('p:myaliasAt', String(nowMs())) } catch { /* fine */ }
  markConfigDirty()
}

// ─── config backup bookkeeping ──────────────────────────────────────
const nowMs = (): number => { try { return Date.now() } catch { return 0 } }
/** updatedAt for a contact (set on save/rename/remove) — drives newest-wins restore merge + the dirty nudge. */
function touchContact(k: string): void { contactsAt[k.toLowerCase()] = nowMs(); persist('p:contactsAt', contactsAt); markConfigDirty() }
/** Mark local config changed since the last backup; refresh the nudge if the Contacts modal is open. */
function markConfigDirty(): void {
  try { localStorage.setItem('p:cfgDirty', String((parseInt(localStorage.getItem('p:cfgDirty') ?? '0', 10) || 0) + 1)) } catch { /* fine */ }
  updateCfgBackupNote()
}

/** Record a self-asserted alias from a key. A saved contact you ACCEPTED (not pinned) follows the key's
 *  renames — it's provably the same key; a contact you gave a CUSTOM label (pinned) stays put. Unsaved keys
 *  just track their latest self-claim (shown as unverified). */
function rememberAlias(pubKeyHex: string, alias: string): void {
  if (alias === '') return
  const k = pubKeyHex.toLowerCase()
  if (contacts[k] != null) {
    if (!pinned[k] && contacts[k] !== alias) { contacts[k] = alias; persist('p:contacts', contacts); touchContact(k) } // follow rename
    return
  }
  if (seenAliases[k] === alias) return
  seenAliases[k] = alias
  persist('p:aliases', seenAliases)
}

/** Apply only each key's LATEST self-claim from a NEWEST-FIRST list (first occurrence per key wins), so an
 *  older message can't revert a more recent rename. */
function applyLatestAliases(items: Array<{ pk: string; alias?: string }>): void {
  const latest = new Map<string, string>()
  for (const it of items) {
    const k = it.pk.toLowerCase()
    if (it.alias != null && it.alias !== '' && !latest.has(k)) latest.set(k, it.alias)
  }
  for (const [pk, alias] of latest) rememberAlias(pk, alias)
}

/** Save a contact. `customLabel` = you typed your own name (pin it; don't auto-follow the key's renames);
 *  otherwise you accepted the key's self-claim (follow future renames). */
function saveContact(pubKeyHex: string, alias: string, customLabel = false): void {
  const k = pubKeyHex.toLowerCase()
  contacts[k] = alias
  if (customLabel) pinned[k] = 1; else delete pinned[k]
  delete seenAliases[k]
  persist('p:contacts', contacts); persist('p:pinned', pinned); persist('p:aliases', seenAliases)
  touchContact(k)
}

function removeContact(pubKeyHex: string): void {
  const k = pubKeyHex.toLowerCase()
  delete contacts[k]; delete pinned[k]
  persist('p:contacts', contacts); persist('p:pinned', pinned)
  touchContact(k) // bump timestamp so a later backup reflects the change (deletes don't sync — no tombstones)
}

function ignoreSeen(pubKeyHex: string): void {
  delete seenAliases[pubKeyHex.toLowerCase()]
  try { localStorage.setItem('p:aliases', JSON.stringify(seenAliases)) } catch { /* fine */ }
}

/** Re-render every surface that shows names, after a contact change. */
function refreshNameSurfaces(): void {
  renderInbox(lastInbox)
  if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed)
  renderTokens()
  updateMsgToName()
}

interface NameInfo { name: string; verified: boolean; isMe: boolean; alias?: string }
function displayName(pubKeyHex: string): NameInfo {
  const k = pubKeyHex.toLowerCase()
  if (k === myPubKeyLc()) { const a = getMyAlias(); return a ? { name: '@' + a, verified: true, isMe: true, alias: a } : { name: short(pubKeyHex), verified: true, isMe: true } }
  if (contacts[k] != null) return { name: '@' + contacts[k], verified: true, isMe: false, alias: contacts[k] }
  if (seenAliases[k] != null) return { name: '@' + seenAliases[k], verified: false, isMe: false, alias: seenAliases[k] }
  return { name: short(pubKeyHex), verified: true, isMe: false }
}
function myPubKeyLc(): string { try { return pubKeyHex.toLowerCase() } catch { return '' } }

/** A key's signature hue (0–359), derived from its pubkey — used by the identicon AND a custom avatar's
 *  ring, so the colour is an un-fakeable per-key anchor either way. */
function keyHue(pubKeyHex: string): number {
  const h = Hash.sha256(Utils.toArray(pubKeyHex.toLowerCase(), 'hex'))
  return ((h[0] << 8) | h[1]) % 360
}

/** A deterministic, key-derived avatar (symmetric 5×5 SVG). Free, universal, and UN-spoofable: a faked
 *  @alias on a different key renders a different pattern, so the icon is a visual identity anchor. */
function identiconSvg(pubKeyHex: string, px = 18): string {
  const h = Hash.sha256(Utils.toArray(pubKeyHex.toLowerCase(), 'hex'))
  const hue = keyHue(pubKeyHex)
  const fg = `hsl(${hue},62%,58%)`
  const bg = `hsl(${hue},22%,20%)`
  const N = 5
  let cells = ''
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h[2 + y * 3 + x] & 1) === 0) continue
      cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`
      if (x < 2) cells += `<rect x="${N - 1 - x}" y="${y}" width="1" height="1"/>` // mirror for symmetry
    }
  }
  return `<svg class="identicon" width="${px}" height="${px}" viewBox="0 0 ${N} ${N}" aria-hidden="true">` +
    `<rect width="${N}" height="${N}" fill="${bg}"/><g fill="${fg}">${cells}</g></svg>`
}

const NO_AVATAR = '-' // p:avatars sentinel: resolved, this key has no published avatar
let avatars: Record<string, string> = {} // pubkeyHex(lc) → avatar data-URL, or NO_AVATAR

function cachedAvatar(pubKeyHex: string): string | null {
  const a = avatars[pubKeyHex.toLowerCase()]
  return a != null && a !== NO_AVATAR ? a : null
}
function setAvatar(pubKeyHex: string, value: string): void {
  avatars[pubKeyHex.toLowerCase()] = value
  try { localStorage.setItem('p:avatars', JSON.stringify(avatars)) } catch { /* quota */ }
}

/** Avatar (published image) if known, else the identicon — both wear the key-derived ring/colour. */
function avatarHtml(pubKeyHex: string, px = 18): string {
  const a = cachedAvatar(pubKeyHex)
  if (a == null) return identiconSvg(pubKeyHex, px)
  return `<img class="avatar identicon" src="${a}" width="${px}" height="${px}" alt="" style="border:1.5px solid hsl(${keyHue(pubKeyHex)},62%,58%)" />`
}

/** HTML for a key reference anywhere it appears: avatar/identicon + @name (copy-to-clipboard the full pubkey,
 *  hover to see it) + an "⚠ unverified" cue for a self-claimed name, and (when `save`) a one-click save. */
function nameChip(pubKeyHex: string, opts: { save?: boolean } = {}): string {
  const info = displayName(pubKeyHex)
  const ico = avatarHtml(pubKeyHex)
  const chip = `<span class="copy-id" data-copy="${pubKeyHex}" title="${pubKeyHex} — click to copy">${escapeHtml(info.name)}</span>`
  if (info.verified) return ico + chip
  const warn = ` <span class="unverified" title="Self-claimed name — verify the key on hover before trusting it">⚠ unverified</span>`
  const save = opts.save ? ` <button class="alias-save" data-pk="${pubKeyHex}" data-alias="${escapeHtml(info.alias ?? '')}">save</button>` : ''
  return ico + chip + warn + save
}

function bytesToDataUrl(mime: string, bytes: number[]): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.slice(i, i + 0x8000))
  return `data:${mime || 'image/webp'};base64,${btoa(bin)}`
}

// Published profiles (avatar + alias) are resolved by pubkey from the key's own address. The persistent
// p:avatars cache gives instant display; we re-resolve each key once PER SESSION so updated profiles (new
// avatar or @name) are picked up rather than cached forever.
const avatarInFlight = new Map<string, Promise<boolean>>()
const profileChecked = new Set<string>() // keys whose profile we've re-resolved this session
async function ensureAvatar(pubKeyHex: string): Promise<boolean> {
  const k = pubKeyHex.toLowerCase()
  if (profileChecked.has(k)) return false
  profileChecked.add(k)
  let p = avatarInFlight.get(k)
  if (p == null) { p = fetchProfileInto(k); avatarInFlight.set(k, p) }
  try { return await p } finally { avatarInFlight.delete(k) }
}
async function fetchProfileInto(k: string): Promise<boolean> {
  try {
    const prof = await resolveProfile(provider, k)
    const newAvatar = prof?.avatarBytes != null && prof.avatarBytes.length > 0
      ? bytesToDataUrl(prof.avatarMimeType ?? 'image/webp', prof.avatarBytes) : NO_AVATAR
    const avatarChanged = avatars[k] !== newAvatar && newAvatar !== NO_AVATAR
    setAvatar(k, newAvatar)
    // The published profile supplies a NAME only as a fallback when we have none (e.g. a storefront publisher
    // you've never messaged). It must NOT override a saved contact or an envelope-provided name — the message
    // envelope is the fresher, authoritative source for renames (a published profile can lag behind it).
    let aliasChanged = false
    if (prof?.alias != null && prof.alias !== '' && contacts[k] == null && seenAliases[k] == null) {
      seenAliases[k] = prof.alias; persist('p:aliases', seenAliases); aliasChanged = true
    }
    return avatarChanged || aliasChanged
  } catch { return false } // transient: leave unresolved for a later retry
}
/** Resolve profiles (avatar + alias) for these keys in the background; re-render if any newly resolved. */
function resolveAvatarsThen(pubKeys: string[], rerender: () => void): void {
  const todo = [...new Set(pubKeys.map(p => p.toLowerCase()))].filter(k => !profileChecked.has(k))
  if (todo.length === 0) return
  void Promise.all(todo.map(ensureAvatar)).then(changed => { if (changed.some(Boolean)) rerender() })
}

// ── Publisher identity ────────────────────────────────────────────────
// The covenant carries only the publisher's hash160; their full pubkey (needed to show an avatar/alias and to
// message them) is recovered once per collection from TX1's funding input (`<sig> <pubkey>`, hash-verified),
// then cached on every held copy of that collection.
const publisherKeyInFlight = new Map<string, Promise<string | null>>()

function myPubKeyHash(): string { return Utils.toHex(Hash.hash160(Utils.toArray(pubKeyHex, 'hex'))) }

async function recoverPublisherKey(collectionId: string, publisherHashHex: string): Promise<string | null> {
  try {
    const tx1 = await provider.getSourceTransaction(collectionId)
    for (const input of tx1.inputs) {
      for (const c of input.unlockingScript?.chunks ?? []) {
        const d = c.data
        if (d != null && (d.length === 33 || d.length === 65) && Utils.toHex(Hash.hash160(d)) === publisherHashHex) {
          const hex = Utils.toHex(d)
          store.setPublisherPubKey(collectionId, hex)
          return hex
        }
      }
    }
  } catch { /* transient (e.g. TX1 not fetchable yet) — leave unresolved for a later pass */ }
  return null
}

function resolvePublisherKey(t: StoredToken): Promise<string | null> {
  if (t.publisherPubKeyHex != null) return Promise.resolve(t.publisherPubKeyHex)
  if (t.publisherPubKeyHashHex == null) return Promise.resolve(null)
  let p = publisherKeyInFlight.get(t.collectionId)
  if (p == null) { p = recoverPublisherKey(t.collectionId, t.publisherPubKeyHashHex); publisherKeyInFlight.set(t.collectionId, p) }
  return p
}

/** Recover unresolved publisher pubkeys (then warm their profiles) in the background; re-render on success. */
function resolvePublisherIdentitiesThen(tokens: StoredToken[], rerender: () => void): void {
  const mine = myPubKeyHash()
  const seen = new Set<string>()
  const todo = tokens.filter(t =>
    t.publisherPubKeyHex == null && t.publisherPubKeyHashHex != null && t.publisherPubKeyHashHex !== mine &&
    !seen.has(t.collectionId) && (seen.add(t.collectionId), true))
  // Warm avatars/aliases for already-resolved publishers regardless.
  const known = tokens.map(t => t.publisherPubKeyHex).filter((v): v is string => v != null)
  if (known.length) resolveAvatarsThen(known, rerender)
  if (todo.length === 0) return
  void Promise.all(todo.map(resolvePublisherKey)).then(keys => {
    const got = keys.filter((v): v is string => v != null)
    if (got.length === 0) return
    resolveAvatarsThen(got, rerender) // pull their profiles too
    rerender()                        // show the chip now (identicon until the avatar lands)
  })
}

interface ComposeCtx { product?: string; recipientRole: 'buyer' | 'publisher' }

/** Substitute message wildcards for one recipient. %buyer% / %publisher% map to the recipient or to you (the
 *  sender) depending on which role the recipient plays; %product% → the collection name. */
function fillWildcards(text: string, recipientKey: string, ctx: ComposeCtx): string {
  const mine = getMyAlias()
  const recip = displayName(recipientKey).alias
  const buyer = ctx.recipientRole === 'buyer' ? (recip ?? 'there') : (mine || 'there')
  const publisher = ctx.recipientRole === 'publisher' ? (recip ?? 'the publisher') : (mine || 'the publisher')
  return text.split('%buyer%').join(buyer).split('%publisher%').join(publisher).split('%product%').join(ctx.product ?? '')
}

/** Compose overlay over the current page (so you return to the same card/scroll on close). One recipient, or
 *  many (a personalized mail-merge: %buyer% per recipient, %product% = the collection — one encrypted tx each).
 *  Reuses the same encrypted-send path as the Messages tab. */
function openCompose(recipients: string[], opts: { who: string } & ComposeCtx): void {
  if (recipients.length === 0) return
  const multi = recipients.length > 1
  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box compose-box">' +
    `<div class="modal-head"><span>✉ Message ${escapeHtml(opts.who)}</span><button class="secondary compose-close">✕ Close</button></div>` +
    `<div class="compose-to${multi ? ' compose-many' : ''}">${recipients.map(r => nameChip(r)).join(multi ? ' ' : '')}</div>` +
    '<textarea class="compose-text" rows="4" placeholder="Write a message…"></textarea>' +
    `<p class="compose-hint muted" style="font-size:11px">Personalize with <code>%buyer%</code> · <code>%publisher%</code>${opts.product != null ? ' · <code>%product%</code>' : ''}</p>` +
    '<div class="compose-preview muted" style="font-size:11px"></div>' +
    '<label class="compose-row"><span>📎 Attach a file</span> <input type="file" class="compose-file" /></label>' +
    '<label class="compose-row"><span><input type="checkbox" class="compose-encrypt" checked /> Encrypt</span> <span class="muted" style="font-size:11px">only they can read it</span></label>' +
    `<div class="row" style="margin-top:10px"><button class="compose-send">${multi ? `Send to ${recipients.length}` : 'Send'}</button></div>` +
    '<p class="compose-status muted" style="font-size:12px;margin-top:8px"></p>' +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.compose-close')?.addEventListener('click', close)
  const textEl = overlay.querySelector('.compose-text') as HTMLTextAreaElement
  const fileEl = overlay.querySelector('.compose-file') as HTMLInputElement
  const encEl = overlay.querySelector('.compose-encrypt') as HTMLInputElement
  const sendBtn = overlay.querySelector('.compose-send') as HTMLButtonElement
  const statusEl = overlay.querySelector('.compose-status') as HTMLElement
  const previewEl = overlay.querySelector('.compose-preview') as HTMLElement
  // Live preview of the merge for the first recipient (only when a wildcard is actually used).
  const updatePreview = (): void => {
    const filled = fillWildcards(textEl.value, recipients[0], opts)
    previewEl.textContent = filled !== textEl.value ? `Preview → ${displayName(recipients[0]).name}: ${filled}` : ''
  }
  textEl.addEventListener('input', updatePreview)
  sendBtn.onclick = () => void (async () => {
    const k = requireKey(); if (k == null) return
    const text = textEl.value
    const file = await readFile(fileEl)
    if (!text.trim() && file == null) { statusEl.textContent = 'Write a message or attach a file first.'; return }
    if (multi && !confirm(
      `Send this message to ${recipients.length} recipients?\n\n` +
      `That's ${recipients.length} separate encrypted transactions — one network fee each` +
      `${file != null ? ' (the file is sent to each)' : ''}. Proceed?`)) return
    sendBtn.disabled = true
    let ok = 0, failed = 0
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i]
      statusEl.textContent = multi ? `Sending ${i + 1}/${recipients.length}…` : 'Sending…'
      const parts: Part[] = []
      const filled = fillWildcards(text, r, opts)
      if (filled.trim()) parts.push({ kind: 'text', text: filled })
      if (file) parts.push({ kind: 'file', mimeType: file.mimeType, fileName: file.fileName, bytes: file.bytes })
      if (parts.length === 0) continue
      try { await sendMessage(provider, k, { toPubKeyHex: r, parts, encrypt: encEl.checked, senderAlias: getMyAlias() }); ok++ }
      catch { failed++ }
    }
    statusEl.textContent = failed === 0
      ? `✅ Sent${multi ? ` to ${ok}` : ''}.`
      : `Sent ${ok}, ${failed} failed${multi ? ' — close and retry the rest' : ''}.`
    if (failed === 0) setTimeout(close, multi ? 1600 : 1200)
    else sendBtn.disabled = false
  })()
  document.body.append(overlay)
  textEl.focus()
}

/** Message one key (NFT-card publisher chip / single buyer row). */
function composeTo(pubKeyHex: string, who: string, ctx: ComposeCtx): void { openCompose([pubKeyHex], { who, ...ctx }) }

/** "Message publisher" from an NFT card. */
function onMessagePublisher(pubKeyHex: string, product?: string): void {
  composeTo(pubKeyHex, 'the publisher', { product, recipientRole: 'publisher' })
}

/** A small "by @publisher [avatar] ✉ Message" row for an edition card; null for non-editions. */
function publisherRowEl(t: StoredToken, myHash: string): HTMLElement | null {
  if (t.publisherPubKeyHashHex == null) return null // not an edition / no publisher recorded
  const row = document.createElement('div')
  row.className = 'token-publisher'
  if (t.publisherPubKeyHashHex === myHash) { row.innerHTML = '<span class="muted">📤 published by you</span>'; return row }
  const pk = t.publisherPubKeyHex
  if (pk == null) { row.innerHTML = '<span class="muted">by publisher…</span>'; return row } // resolving
  row.innerHTML = `<span class="muted">by</span> ${nameChip(pk)} `
  const msg = document.createElement('button')
  msg.className = 'link-btn'; msg.textContent = '✉ Message'
  msg.onclick = e => { e.stopPropagation(); onMessagePublisher(pk, t.collectionName) }
  row.append(msg)
  return row
}

function onAliasSaveClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement | null)?.closest('.alias-save') as HTMLElement | null
  if (btn == null) return
  const pk = btn.dataset.pk ?? ''
  const alias = btn.dataset.alias ?? ''
  if (pk === '') return
  saveContact(pk, alias)
  toast(`Saved @${alias}`)
  renderInbox(lastInbox) // reflect the now-verified name in the inbox
  if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed) // …and in the updates feed
  updateMsgToName()
}

/** Live hint under the compose "to" field: show @name when the entered key has a known alias. */
function updateMsgToName(): void {
  const to = val('msgTo')
  const el = $('msgToName')
  if (to.length !== 66 && to.length !== 130) { el.innerHTML = ''; return }
  const info = displayName(to)
  el.innerHTML = info.isMe ? '↪ that’s your own key' : (info.alias != null ? `→ ${nameChip(to, { save: true })}` : '')
}

// ─── config backup / restore ────────────────────────────────────────
function cfgDirtyCount(): number { try { return parseInt(localStorage.getItem('p:cfgDirty') ?? '0', 10) || 0 } catch { return 0 } }
function lastBackupAt(): number { try { return parseInt(localStorage.getItem('p:cfgBackupAt') ?? '0', 10) || 0 } catch { return 0 } }

/** Refresh the "N changes since last backup" nudge in the Contacts modal (no-op if it isn't mounted). */
function updateCfgBackupNote(): void {
  const el = document.getElementById('cfgBackupNote'); if (el == null) return
  const n = cfgDirtyCount(); const at = lastBackupAt()
  el.textContent = at === 0
    ? (Object.keys(contacts).length ? 'Not backed up yet.' : 'Nothing to back up yet.')
    : n > 0 ? `⚠ ${n} change${n > 1 ? 's' : ''} since last backup (${fmtTime(at)}).`
    : `✓ Backed up ${fmtTime(at)}.`
}

async function onConfigBackup(): Promise<void> {
  const myKey = requireKey(); if (myKey == null) return
  const btn = $('btnCfgBackup') as HTMLButtonElement
  btn.disabled = true; setStatus('Backing up your config (encrypted to your key)…')
  try {
    let prefs: Record<string, string> = {}
    // p:refBy (who gifted this wallet) + p:affRefCode (your own ref-code) ride along so referral attribution
    // survives a wallet restore on a new device (option-1 cross-device carry).
    try { for (const k of ['p:nftview', 'p:nftsort', 'p:refBy', 'p:affRefCode']) { const v = localStorage.getItem(k); if (v != null) prefs[k] = v } } catch { prefs = {} }
    const aliasAt = (() => { try { return parseInt(localStorage.getItem('p:myaliasAt') ?? '0', 10) || 0 } catch { return 0 } })()
    const txId = await publishConfigBackup(provider, myKey,
      { alias: getMyAlias() || undefined, aliasAt, contacts, contactsAt, prefs }, nowMs())
    try { localStorage.setItem('p:cfgBackupAt', String(nowMs())); localStorage.setItem('p:cfgDirty', '0') } catch { /* fine */ }
    updateCfgBackupNote()
    setStatus(`☁ Config backed up (encrypted). Tx ${short(txId)}.`, 'ok')
  } catch (e) {
    setStatus(`Backup failed: ${(e as Error).message}`, 'error')
  } finally { btn.disabled = false }
}

/** Restore the latest backup and merge it in (newest-wins). Returns how many entries the backup contributed. */
async function restoreConfigFromChain(quiet = false): Promise<number> {
  const myKey = requireKey(); if (myKey == null) return 0
  const blob = await resolveConfigBackup(provider, myKey)
  if (blob == null) { if (!quiet) setStatus('No config backup found for this key.'); return 0 }
  const aliasAt = (() => { try { return parseInt(localStorage.getItem('p:myaliasAt') ?? '0', 10) || 0 } catch { return 0 } })()
  const merged = mergeConfig({ alias: getMyAlias() || undefined, aliasAt, contacts, contactsAt }, blob)
  contacts = merged.contacts; contactsAt = merged.contactsAt
  persist('p:contacts', contacts); persist('p:contactsAt', contactsAt)
  if (merged.alias != null && merged.alias !== getMyAlias()) {
    try { localStorage.setItem('p:myalias', merged.alias); if (merged.aliasAt != null) localStorage.setItem('p:myaliasAt', String(merged.aliasAt)) } catch { /* fine */ }
    const ai = document.getElementById('myAlias') as HTMLInputElement | null
    if (ai != null) ai.value = merged.alias ? '@' + merged.alias : ''
  }
  // Restore UI prefs (only sets that aren't already chosen locally is overkill — backup is authoritative for prefs).
  if (blob.prefs != null) { try { for (const [k, v] of Object.entries(blob.prefs)) localStorage.setItem(k, v) } catch { /* fine */ } }
  return merged.changed
}

async function onConfigRestore(): Promise<void> {
  const btn = $('btnCfgRestore') as HTMLButtonElement
  btn.disabled = true; setStatus('Looking for your config backup…')
  try {
    const changed = await restoreConfigFromChain()
    if (changed >= 0) { renderContacts(); updateCfgBackupNote(); refreshNameSurfaces() }
    if (changed > 0) setStatus(`⤓ Restored — ${changed} contact${changed > 1 ? 's' : ''} added/updated from your backup.`, 'ok')
    else setStatus('Config restore: nothing new to merge (already up to date).', 'ok')
  } catch (e) {
    setStatus(`Restore failed: ${(e as Error).message}`, 'error')
  } finally { btn.disabled = false }
}

// ─── address book ───────────────────────────────────────────────────
function openContactsModal(): void {
  renderContacts()
  updateCfgBackupNote()
  resolveAvatarsThen([...Object.keys(contacts), ...Object.keys(seenAliases)], renderContacts)
  $('contactsModal').style.display = 'flex'
}
function closeContactsModal(): void { $('contactsModal').style.display = 'none' }

function renderContacts(): void {
  const host = $('contactsBody')
  host.innerHTML = ''
  const byName = (a: [string, string], b: [string, string]): number => a[1].localeCompare(b[1])
  const saved = Object.entries(contacts).sort(byName)
  const seen = Object.entries(seenAliases).sort(byName)
  host.append(contactsSection(`Saved (${saved.length})`, saved, 'saved', 'No saved contacts yet — save senders from your inbox, or add one above.'))
  host.append(contactsSection(`Seen, not saved (${seen.length})`, seen, 'seen', 'No unsaved names seen yet.'))
}

function contactsSection(title: string, rows: [string, string][], kind: 'saved' | 'seen', empty: string): HTMLElement {
  const sec = document.createElement('div')
  sec.className = 'token-section'
  const head = document.createElement('div')
  head.className = 'token-section-head'; head.style.cursor = 'default'
  head.innerHTML = `<span class="token-section-label">${title}</span>`
  sec.append(head)
  if (rows.length === 0) {
    const p = document.createElement('p'); p.className = 'muted'; p.style.fontSize = '12px'; p.textContent = empty
    sec.append(p); return sec
  }
  for (const [pk, alias] of rows) sec.append(contactRow(pk, alias, kind))
  return sec
}

function contactRow(pk: string, alias: string, kind: 'saved' | 'seen'): HTMLElement {
  const row = document.createElement('div')
  row.className = 'contact-row'
  row.innerHTML = `${avatarHtml(pk, 24)} <span class="contact-name">@${escapeHtml(alias)}</span> <span class="copy-id" data-copy="${pk}" title="${pk} — click to copy">${short(pk)}</span>`
  const acts = document.createElement('span')
  acts.className = 'contact-acts'
  const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = label; b.className = 'secondary'; b.onclick = fn; return b
  }
  if (kind === 'saved') {
    acts.append(
      mkBtn('Rename', () => {
        const n = prompt('New name for this contact:', alias)
        if (n == null) return
        const nm = n.replace(/^@+/, '').trim()
        if (nm) { saveContact(pk, nm, true); renderContacts(); refreshNameSurfaces() }
      }),
      mkBtn('Remove', () => { removeContact(pk); renderContacts(); refreshNameSurfaces() }),
    )
  } else {
    acts.append(
      mkBtn('Save', () => { saveContact(pk, alias); renderContacts(); refreshNameSurfaces() }),
      mkBtn('Ignore', () => { ignoreSeen(pk); renderContacts() }),
    )
  }
  row.append(acts)
  return row
}

function onAddContact(): void {
  const pk = val('contactPk').toLowerCase()
  const name = val('contactName').replace(/^@+/, '').trim()
  if (pk.length !== 66 && pk.length !== 130) { toast('Enter a valid pubkey (66 or 130 hex chars)'); return }
  if (!/^[0-9a-f]+$/.test(pk)) { toast('Pubkey must be hex'); return }
  if (name === '') { toast('Enter a name for this contact'); return }
  saveContact(pk, name, true)
  ;($('contactPk') as HTMLInputElement).value = ''
  ;($('contactName') as HTMLInputElement).value = ''
  renderContacts(); refreshNameSurfaces()
  toast(`Saved @${name}`)
}

// ─── init ───────────────────────────────────────────────────────────
// ─── collection / sales view (shareable link landing) ───────────────
// A link of the form  …/#c=<TX1-txid>[&h=<holderPubKey>]  opens a public storefront page for a
// collection (PLAN.md Step 2). `c` is the Collection ID (TX1 txid); `h` (optional) names the holder
// whose edition a buyer will replicate from — the tip-resolution + buy flow land in the next steps.

interface CollectionInfo {
  tx1Ref: string
  name: string
  description: string
  cover: { mimeType: string; bytes: number[] } | null
  /** Optional flippable back cover (sales page). */
  backCover: { mimeType: string; bytes: number[] } | null
  encrypted: boolean
  replicable: boolean
  hasContentFile: boolean
  /** SHA-256 (hex) of the embedded content, committed in the TX1 template — used to reference this collection
   *  from a combination/EP manifest (and to integrity-check the resolved content). null if no content file. */
  fileHash: string | null
  publisherPubKeyHex: string | null
  fees: { publisher: number; holder: number } | null
  /** v2 (percentage pricing): publisher basis points + the genesis/reference price (the seller's live price is
   *  resolved at buy time). */
  isV2: boolean
  pBps: number
  v2PriceSats: number
  /** The collection's covenant template bytes (hex) — lets the buy flow reconstruct a holder's edition. */
  covenantHex: string
  /** Refundable bond a buyer funds into their own copy (sats) = the genesis edition output value. 0 if none. */
  bondSats: number
}

let cvObjectUrl: string | null = null
let cvBackObjectUrl: string | null = null // back-cover object URL for the sales-page flip
let cvPreviewObjectUrl: string | null = null // audio-preview object URL for the sales page
let currentCollection: { info: CollectionInfo; holderPubKey: string | null } | null = null
/** The seller's current note (promo + optional bonus) for the open collection, captured onto a purchase. */
let cvNote: SellerNote | null = null
/** Funded voucher WIF from a `&g=` gift link — when set, "Get a copy" claims free (the voucher pays). */
let cvGiftWif: string | null = null

function setCvStatus(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const el = $('cvStatus')
  el.textContent = msg
  el.className = `cv-status ${kind === 'info' ? '' : kind}`.trim()
}

// The buy/claim CTA appears twice — a hero copy up top (above the fold) and the one in the buy card —
// so it's reachable without scrolling. These keep both in lockstep (same label + disabled state).
function cvGetButtons(): HTMLButtonElement[] {
  return (['cvGet', 'cvGetTop'].map(id => document.getElementById(id)).filter(Boolean) as HTMLButtonElement[])
}
function setCvGetLabel(text: string): void { for (const b of cvGetButtons()) b.textContent = text }
function setCvGetDisabled(disabled: boolean): void { for (const b of cvGetButtons()) b.disabled = disabled }

/** Reflect ownership on the storefront's buy buttons: once this wallet holds a copy, GHOST them to
 *  "✓ You own a copy" (disabled) so a stray second click can't accidentally buy again — and reveal a
 *  low-key "Buy another copy" link for the rare deliberate re-purchase (editions are uncapped). Otherwise
 *  the normal "Get a copy" button. Skipped entirely during a gift claim (its label/flow is special). */
function reflectCvOwnership(info: CollectionInfo): void {
  const buyable = info.fees != null || info.isV2
  const another = document.getElementById('cvBuyAnother') as HTMLElement | null
  if (cvGiftWif) { setCvGetDisabled(!buyable); if (another) another.style.display = 'none'; return }
  const owns = store.active().some(t => t.collectionId === info.tx1Ref)
  if (owns && buyable) {
    for (const b of cvGetButtons()) { b.disabled = true; b.textContent = '✓ You own a copy'; b.classList.add('owned') }
    if (another) another.style.display = ''
  } else {
    for (const b of cvGetButtons()) { b.disabled = !buyable; b.textContent = 'Get a copy'; b.classList.remove('owned') }
    if (another) another.style.display = 'none'
  }
}

/** Read a `#c=…&h=…` hash route, or null if absent. Also captures a referral `aff` ref-code for this session. */
function parseHashRoute(): { c: string; h: string | null; g: string | null } | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const aff = params.get('aff')
  if (aff != null && aff !== '') incomingAff = aff // a share link's referral overrides the default Buy-BSV code
  const c = params.get('c')
  if (!c) return null
  return { c, h: params.get('h'), g: params.get('g') }
}

/** Fetch TX1 and extract everything the storefront page needs (template + storefront + fees). */
async function loadCollection(tx1Ref: string, holderPubKeyHint?: string | null): Promise<CollectionInfo> {
  // Read ONLY the small metadata outputs (template + storefront), skipping any large embedded content file,
  // so the sales page renders without pulling the whole (possibly tens-of-MB) TX1. Layout is deterministic:
  // [0]=template, [1]=file (may be huge), [2]=storefront, [last]=change. We scan outputs with a size cap; an
  // output too big to fetch IS the content file (→ hasContentFile), skipped without downloading its body.
  let template: TemplateFields | undefined
  let publisherPubKeyHex: string | null = null
  let storefront: StorefrontFields | null = null
  let hasContentFile = false
  // template is [0]; storefront comes after the (possibly huge) file, so once we have both we can stop — that
  // also avoids WoC's 502-on-out-of-range past the last output. Any fetch error on an index is treated as a
  // skip (not a hard failure) so a transient/late hiccup can't break a load that already has what it needs.
  for (let i = 0; i < 6; i++) {
    let hex: string | 'oversized' | null
    try { hex = await provider.getOutputScriptHexCapped(tx1Ref, i, 8 * 1024 * 1024) } // headroom for a rich animated front+back storefront cover
    catch { hex = null }
    if (hex == null) { if (template != null) break; continue }
    if (hex === 'oversized') { hasContentFile = true; continue } // the embedded content file — skipped, not downloaded
    const script = LockingScript.fromHex(hex)
    const t = parseTemplateScript(script)
    if (t) { template = t.fields; publisherPubKeyHex = t.publisherPubKeyHex }
    const s = parseStorefrontScript(script)
    if (s) storefront = s.fields
    if (parseFileScript(script)) hasContentFile = true          // a SMALL embedded file (fetched under the cap)
    if (template != null && storefront != null) break           // have everything the sales page needs
  }
  if (!template) throw new Error('not a SMART NFTs collection (no template output in TX1)')
  const rules = decodeTokenRules(template.tokenRules)
  let fees: { publisher: number; holder: number } | null = null
  let isV2 = false, pBps = 0, v2PriceSats = 0
  if (template.covenantScript) {
    try {
      const ed = parseEditionAny(LockingScript.fromHex(template.covenantScript))
      if (ed?.isV2) { isV2 = true; pBps = ed.terms.pBps; v2PriceSats = ed.priceSats }
      else if (ed) fees = { publisher: ed.terms.publisherFeeSats, holder: ed.terms.holderFeeSats }
    } catch { /* leave null — non-replicable or unparseable covenant */ }
  }
  // Refundable bond: read it from the live edition tip (a small script-hash fetch), NOT the big TX1 — the
  // template output's value isn't recoverable without the full tx. Resolved only when a holder context is
  // supplied (the sales page); callers needing just name/publisher (the updates feed) omit it and skip this hop.
  let bondSats = 0
  if (holderPubKeyHint !== undefined && template.covenantScript) {
    const sellerPub = holderPubKeyHint ?? publisherPubKeyHex
    if (sellerPub != null) {
      try {
        const tip = await resolveHolderEdition(provider, { tx1RefHex: tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: template.covenantScript })
        if (tip) bondSats = tip.tokenSats ?? 0
      } catch { /* best-effort — leave the bond unknown */ }
    }
  }
  const cover = storefront?.coverBytes
    ? { mimeType: storefront.coverMimeType ?? 'application/octet-stream', bytes: storefront.coverBytes }
    : null
  // Back cover only counts if it's genuinely an IMAGE — a non-image (e.g. a zip mis-parked in the back-cover
  // slot at mint) otherwise shows an empty flip on the sales page.
  const backCover = storefront?.backCoverBytes && (storefront.backCoverMimeType ?? '').toLowerCase().startsWith('image/')
    ? { mimeType: storefront.backCoverMimeType ?? 'image/jpeg', bytes: storefront.backCoverBytes }
    : null
  return {
    tx1Ref, name: template.tokenName, description: storefront?.description ?? '',
    cover, backCover, encrypted: rules.isEncrypted, replicable: rules.isReplicable, hasContentFile,
    fileHash: template.fileHash ?? null,
    publisherPubKeyHex, fees, isV2, pBps, v2PriceSats, covenantHex: template.covenantScript, bondSats,
  }
}

function renderCollectionView(info: CollectionInfo): void {
  $('cvTitle').textContent = info.name || 'Untitled collection'
  const coverHost = $('cvCover')
  coverHost.innerHTML = ''
  if (cvObjectUrl) { URL.revokeObjectURL(cvObjectUrl); cvObjectUrl = null }
  if (cvBackObjectUrl) { URL.revokeObjectURL(cvBackObjectUrl); cvBackObjectUrl = null }
  if (cvPreviewObjectUrl) { URL.revokeObjectURL(cvPreviewObjectUrl); cvPreviewObjectUrl = null }
  if (info.cover) {
    cvObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(info.cover.bytes)], { type: info.cover.mimeType }))
    const img = document.createElement('img'); img.src = cvObjectUrl; img.className = 'cv-cover-img'
    coverHost.append(img)
    // Optional flippable back cover: a small "⇄" button over the cover toggles front ⇄ back.
    if (info.backCover) {
      cvBackObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(info.backCover.bytes)], { type: info.backCover.mimeType }))
      let showingBack = false
      const flip = document.createElement('button'); flip.type = 'button'; flip.className = 'cv-flip'
      flip.textContent = '⇄ Back'; flip.title = 'Flip the cover'
      flip.onclick = () => {
        showingBack = !showingBack
        img.src = showingBack ? cvBackObjectUrl! : cvObjectUrl!
        flip.textContent = showingBack ? '⇄ Front' : '⇄ Back'
      }
      coverHost.append(flip)
    }
  } else {
    coverHost.innerHTML = '<div class="cv-cover-ph">🎴</div>'
  }
  // Public audio preview — a lazy "🎧 Preview": resolve + play only when a prospective buyer asks, so the sales
  // page never fetches the (large) clip unless someone wants to listen. Plaintext/public — no holder gate.
  const prevHost = $('cvPreview')
  prevHost.innerHTML = ''
  const pubForPreview = info.publisherPubKeyHex
  if (pubForPreview != null) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary'
    btn.textContent = '🎧 Preview'
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '⏳ Loading preview…'
      try {
        const clip = await resolvePreview(provider, pubForPreview, info.tx1Ref)
        if (!clip) { btn.textContent = '🔇 No preview yet'; return }
        if (cvPreviewObjectUrl) URL.revokeObjectURL(cvPreviewObjectUrl)
        cvPreviewObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(clip.bytes)], { type: clip.mimeType || 'audio/mpeg' }))
        const audio = document.createElement('audio'); audio.controls = true; audio.autoplay = true; audio.src = cvPreviewObjectUrl
        audio.style.width = '100%'
        audio.setAttribute('controlsList', 'nodownload') // hide the native download — a blob url saves an unnamed file
        // Our own download link so the clip saves as the collection title ("Artist - Track.mp3"). Blob urls are
        // same-origin, so the download attribute's filename is honoured.
        const ext = /mp4|m4a|aac/i.test(clip.mimeType || '') ? 'm4a' : 'mp3'
        const base = (info.name || 'preview').replace(/[\/\\:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'preview'
        const dl = document.createElement('a'); dl.href = cvPreviewObjectUrl; dl.download = `${base}.${ext}`
        dl.textContent = '⬇ Download'; dl.title = 'Download the preview clip'
        dl.style.cssText = 'display:inline-block;margin-top:6px;font-size:12px;color:var(--muted);text-decoration:none'
        prevHost.replaceChildren(audio, dl)
      } catch (e) {
        btn.disabled = false; btn.textContent = '🎧 Preview'
        setCvStatus(`Preview failed: ${(e as Error).message}`, 'error')
      }
    }
    prevHost.append(btn)
  }
  const badges: string[] = []
  if (info.replicable) badges.push('<span class="badge">♾ Unlimited editions</span>')
  if (info.encrypted) badges.push('<span class="badge" style="background:#9e6a03;color:#1a1206">🔒 Holders only</span>')
  else if (info.hasContentFile) badges.push('<span class="badge" style="background:#21262d;color:var(--fg)">📎 Embedded file</span>')
  $('cvBadges').innerHTML = badges.join('')
  $('cvPublisher').innerHTML = info.publisherPubKeyHex ? `by ${nameChip(info.publisherPubKeyHex)}` : ''
  if (info.publisherPubKeyHex != null) {
    const pub = info.publisherPubKeyHex
    resolveAvatarsThen([pub], () => { $('cvPublisher').innerHTML = `by ${nameChip(pub)}` })
  }
  $('cvDesc').textContent = info.description || '(no description provided)'
  const bond = info.bondSats || 0
  // Show the real buyer total: the seller's price/fees PLUS the refundable bond locked into the buyer's own copy.
  const bondBit = bond > 1 ? ` + ${fmtPrice(bond)} refundable bond` : ''
  const bondTail = bond > 1 ? `; the ${fmtPrice(bond)} bond is reclaimable by burning your copy` : ''
  if (info.isV2) {
    const total = info.v2PriceSats + bond
    $('cvPrice').innerHTML = `Get your own copy — <b title="${total.toLocaleString()} sats">${fmtPrice(total)}</b> <span class="muted">` +
      `(reseller's price ${fmtPrice(info.v2PriceSats)}${bondBit}; publisher takes ${(info.pBps / 100).toFixed(2)}% = ${Math.floor(info.v2PriceSats * info.pBps / 10000)} sats, plus a small network fee${bondTail})</span>`
  } else if (info.fees) {
    const total = info.fees.publisher + info.fees.holder + bond
    $('cvPrice').innerHTML = `Get your own copy — <b title="${total.toLocaleString()} sats">${fmtPrice(total)}</b> <span class="muted">(publisher ${info.fees.publisher} + holder ${info.fees.holder}${bondBit}, plus a small network fee${bondTail})</span>`
  } else {
    $('cvPrice').innerHTML = '<span class="muted">This collection is not a replicable edition.</span>'
  }
  // Buy buttons reflect ownership: ghosted to "✓ You own a copy" if this wallet already holds one (prevents an
  // accidental re-buy on revisit), else the normal "Get a copy". (A gift claim overrides the label afterwards.)
  reflectCvOwnership(info)
  // Show a "View content" button if this wallet already holds an edition of this collection.
  const holdsIt = store.active().some(t => t.collectionId === info.tx1Ref)
  showViewButton(info, holdsIt)
  $('collectionView').style.display = 'flex'
}

/** Reveal the sales-page "View content" button for holders (label reflects encryption). */
function showViewButton(info: CollectionInfo, show: boolean): void {
  const vb = $('cvView') as HTMLButtonElement
  if (show && info.hasContentFile) {
    vb.textContent = info.encrypted ? '🔓 View content' : 'View content'
    vb.style.display = ''
  } else {
    vb.style.display = 'none'
  }
}

async function openCollectionView(tx1Ref: string, holderPubKey: string | null, giftWif: string | null = null): Promise<void> {
  cvGiftWif = giftWif
  $('collectionView').style.display = 'flex'
  hideFundPrompt()
  $('cvTitle').textContent = 'Loading…'
  $('cvCover').innerHTML = ''
  $('cvBadges').innerHTML = ''
  $('cvPublisher').textContent = ''
  $('cvDesc').textContent = ''
  $('cvPrice').innerHTML = ''
  setCvStatus('Loading collection from the chain…')
  try {
    const info = await loadCollection(tx1Ref, holderPubKey)
    currentCollection = { info, holderPubKey }
    renderCollectionView(info)
    void registerOgAssets(info) // cache this collection's preview assets so its shared links get a rich card
    if (cvGiftWif) {
      // Reframe the page as a free gift claim.
      setCvGetLabel('🎁 Get your free copy')
      $('cvPrice').innerHTML = '🎁 <b>A free gift from the publisher</b> <span class="muted">— claim your copy, no payment and no funds needed.</span>'
    }
    setCvStatus('')
    // Resolve the seller's current promo note (async, best-effort) for the link's seller.
    void loadSellerNote(info, holderPubKey ?? info.publisherPubKeyHex)
  } catch (e) {
    currentCollection = null
    $('cvTitle').textContent = 'Collection not found'
    setCvStatus(`Could not load this collection: ${(e as Error).message}`, 'error')
  }
}

/** Open the sales page for an edition you hold, as its seller (so Share yields YOUR link). */
function onOpenSalesPage(t: StoredToken): void {
  history.replaceState(null, '', `${location.pathname}#c=${t.collectionId}&h=${pubKeyHex}`)
  void openCollectionView(t.collectionId, pubKeyHex)
}

function closeCollectionView(): void {
  $('collectionView').style.display = 'none'
  if (cvObjectUrl) { URL.revokeObjectURL(cvObjectUrl); cvObjectUrl = null }
  if (cvBackObjectUrl) { URL.revokeObjectURL(cvBackObjectUrl); cvBackObjectUrl = null }
  if (cvPreviewObjectUrl) { URL.revokeObjectURL(cvPreviewObjectUrl); cvPreviewObjectUrl = null }
  // Drop the hash so a reload returns to the wallet rather than re-opening the storefront.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
}

/** The sales-page link for the current collection, from the current seller's perspective (routed holder
 *  else this wallet). Null if no collection is open. */
async function currentShareLink(): Promise<string | null> {
  if (!currentCollection) return null
  const { info, holderPubKey } = currentCollection
  const h = holderPubKey ?? pubKeyHex
  return (await shortShareBase(info.tx1Ref, h)) ?? collectionShareUrl(info.tx1Ref, h)
}

async function shareCollectionLink(): Promise<void> {
  const link = await currentShareLink()
  if (!link) return
  void navigator.clipboard?.writeText(link)
  setCvStatus('Share link copied to clipboard.')
}

/** Pop a centered modal showing a scannable QR for `text`, with the text printed below it. */
function showQrModal(title: string, text: string): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box qr-modal-box">' +
    `<div class="modal-head"><span>${escapeHtml(title)}</span><button class="secondary qr-close">✕ Close</button></div>` +
    `<div class="qr-holder">${qrSvg(text)}</div>` +
    `<div class="qr-cap mono">${escapeHtml(text)}</div></div>`
  const close = (): void => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.qr-close')?.addEventListener('click', close)
  document.body.append(overlay)
}

/** Render the bonus area: a claim CTA for a holder, else a teaser; nothing if there's no bonus. */
function hideBonus(): void { const h = $('cvBonus'); h.style.display = 'none'; h.innerHTML = '' }
function showBonus(note: SellerNote | null, claimable: boolean): void {
  const host = $('cvBonus')
  host.innerHTML = ''
  if (!note?.bonusValue) { host.style.display = 'none'; return }
  if (!claimable) {
    host.textContent = '🎁 Includes a bonus — claim it after you buy.'
  } else if (note.bonusKind === 'link') {
    const a = document.createElement('a')
    a.href = note.bonusValue; a.target = '_blank'; a.rel = 'noopener'
    a.textContent = '🎁 Claim your bonus ↗'; a.className = 'bonus-claim'
    host.append(a)
  } else {
    host.append(document.createTextNode('🎁 Bonus code: '))
    const code = document.createElement('span'); code.className = 'mono'; code.textContent = note.bonusValue
    const copy = document.createElement('button'); copy.className = 'secondary'; copy.textContent = 'Copy'; copy.style.marginLeft = '8px'
    copy.onclick = () => void navigator.clipboard?.writeText(note.bonusValue!)
    host.append(code, copy)
  }
  host.style.display = 'block'
}

/** Resolve and show the seller's current note for the open collection; show the editor if it's my page. */
async function loadSellerNote(info: CollectionInfo, sellerPub: string | null): Promise<void> {
  cvNote = null
  const noteBox = $('cvNote')
  noteBox.style.display = 'none'
  hideBonus()
  const isMine = sellerPub != null && sellerPub === pubKeyHex
  const holdsIt = store.active().some(t => t.collectionId === info.tx1Ref)
  $('cvNoteEdit').style.display = isMine ? 'block' : 'none'
  ;($('cvNoteText') as HTMLTextAreaElement).value = ''
  ;($('cvNoteHeading') as HTMLInputElement).value = ''
  ;($('cvNoteTags') as HTMLInputElement).value = ''
  ;($('cvBonusValue') as HTMLInputElement).value = ''
  ;($('cvBonusKind') as HTMLSelectElement).value = 'none'
  $('cvNoteStatus').textContent = ''
  if (sellerPub == null) return
  let current: SellerNote | null = null
  try {
    const note = await resolveSellerNote(provider, sellerPub, info.tx1Ref)
    if (note) current = note
  } catch { /* best-effort — a missing note is normal */ }
  // Hands-off propagation: if the seller hasn't published their own, use the note that rode in on their
  // edition (the on-chain echo from when they acquired it).
  if (current == null && info.covenantHex) {
    try {
      const tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex })
      if (tip) current = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref)
    } catch { /* best-effort */ }
  }
  // Carry-forward: on my own page, if nothing resolved, offer what I captured when I bought.
  if (current == null && isMine) {
    const held = store.active().find(t => t.collectionId === info.tx1Ref && (t.sellerNote || t.bonusValue))
    if (held) {
      current = { text: held.sellerNote ?? '', bonusKind: held.bonusKind, bonusValue: held.bonusValue }
      $('cvNoteStatus').textContent = 'This is what you received when you bought — Publish to pass it on.'
    }
  }
  if (current && (current.text || current.bonusValue || current.heading || (current.tags && current.tags.length > 0))) {
    cvNote = current
    paintCvNote(current)
    showBonus(current, holdsIt) // holder sees a claim button; everyone else a teaser
    if (isMine) {
      ;($('cvNoteText') as HTMLTextAreaElement).value = current.text
      ;($('cvNoteHeading') as HTMLInputElement).value = current.heading ?? ''
      ;($('cvNoteTags') as HTMLInputElement).value = (current.tags ?? []).map(t => '#' + t).join(' ')
      if (current.bonusKind && current.bonusValue) {
        ;($('cvBonusKind') as HTMLSelectElement).value = current.bonusKind
        ;($('cvBonusValue') as HTMLInputElement).value = current.bonusValue
      }
    }
  }
}

/** Render the seller note (heading + description + tags) into the storefront note box. */
function paintCvNote(note: SellerNote): void {
  const box = $('cvNote')
  const parts: string[] = []
  if (note.heading) parts.push(`<b>${escapeHtml(note.heading)}</b>`)
  if (note.text) parts.push(`📝 ${escapeHtml(note.text)}`)
  if (note.tags && note.tags.length > 0) parts.push(`<span class="cv-note-tags">${note.tags.map(t => '#' + escapeHtml(t)).join(' ')}</span>`)
  box.innerHTML = parts.join('<br>')
  box.style.display = parts.length > 0 ? 'block' : 'none'
}

/** Parse a tags input ("#software #tools" or comma-separated) into slug-like tags. */
function parseTagsInput(s: string): string[] {
  return s.split(/[\s,]+/).map(t => t.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean)
}

async function onSaveSellerNote(): Promise<void> {
  const k = requireKey(); if (k == null) return
  if (!currentCollection) return
  const text = ($('cvNoteText') as HTMLTextAreaElement).value.trim()
  const heading = ($('cvNoteHeading') as HTMLInputElement).value.trim()
  const tags = parseTagsInput(($('cvNoteTags') as HTMLInputElement).value)
  const bonusKindRaw = ($('cvBonusKind') as HTMLSelectElement).value
  const bonusValue = ($('cvBonusValue') as HTMLInputElement).value.trim()
  const bonusKind = (bonusKindRaw === 'link' || bonusKindRaw === 'code') ? bonusKindRaw : undefined
  if (!text && !bonusValue && !heading && tags.length === 0) { $('cvNoteStatus').textContent = 'Add a heading, description, tags, or a bonus first.'; return }
  if (bonusValue && !bonusKind) { $('cvNoteStatus').textContent = 'Pick a bonus type (link or code).'; return }
  const note: SellerNote = { text, heading: heading || undefined, tags: tags.length > 0 ? tags : undefined, bonusKind, bonusValue: bonusValue || undefined }
  $('cvNoteStatus').textContent = 'Publishing your note…'
  try {
    const txId = await publishSellerNote(provider, k, currentCollection.info.tx1Ref, note)
    cvNote = note
    paintCvNote(note)
    showBonus(note, true)
    $('cvNoteStatus').textContent = `Published (${short(txId)}). Buyers will see it shortly.`
  } catch (e) {
    $('cvNoteStatus').textContent = `Failed: ${(e as Error).message}`
  }
}

function showFundPrompt(needed: number, have: number): void {
  $('cvFundNeed').textContent = `${needed} sats`
  $('cvFundHave').textContent = `${have} sats`
  $('cvFundAddr').textContent = address
  // Inline payment QR with the amount needed (BIP21 bitcoin: URI — the BSV standard).
  $('cvFundQr').innerHTML = `<div class="qr-holder qr-fund">${qrSvg(bsvPaymentUri(address, needed))}</div>`
  $('cvFund').style.display = 'block'
  setCvStatus('Not enough funds yet — send a little BSV to your wallet, then click “I’ve funded”.', 'error')
  // The fund panel sits below the buy card — make sure it's visible when it appears (esp. from the top button).
  $('cvFund').scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function hideFundPrompt(): void { $('cvFund').style.display = 'none' }

// "Get a copy": resolve the seller's current edition → fund check → permissionless replicate → reveal.
let buying = false
async function onGetCopy(): Promise<void> {
  if (buying || !currentCollection) return
  const k = requireKey(); if (k == null) return
  const { info, holderPubKey } = currentCollection
  if ((!info.fees && !info.isV2) || !info.covenantHex) { setCvStatus('This collection is not a buyable edition.', 'error'); return }
  const sellerPub = holderPubKey ?? info.publisherPubKeyHex
  if (!sellerPub) { setCvStatus('No seller could be determined for this link.', 'error'); return }

  buying = true
  setCvGetDisabled(true)
  try {
    setCvStatus('Finding the seller’s current edition…')
    let tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex })
    if (!tip) { setCvStatus('This seller has no edition available right now — try another link or ask them to mint one.', 'error'); return }

    // ── Gift claim: a funded voucher (in the link) pays the whole tx; the recipient just owns the copy.
    //    No price prompt, no fund check, works for a brand-new or existing wallet.
    if (cvGiftWif) {
      if (!confirm('Add this NFT gift to your wallet now?\n\nIt will be claimed to the wallet on THIS browser and device — make sure this is where you want to keep it.\n\nOr you can cancel and instead claim it later, on a different browser or device, from the same link.')) {
        setCvStatus('No problem — your gift is still waiting. Claim it any time from this link.')
        return // finally re-enables the button + clears the buying flag
      }
      // Brand-new wallet? Secure the seed FIRST — it's the only key to the NFT we're about to add, so
      // back it up BEFORE broadcasting the claim. The gated modal's only exit is its confirm button, so
      // this await resolves once the user has written the phrase down; only then does the claim proceed.
      if (needsSeedBackup()) {
        await new Promise<void>(resolve => showSeedModal(localStorage.getItem(MNEMONIC_KEY) ?? '', {
          gated: true,
          intro: 'First, secure your new wallet — this seed phrase is the ONLY key to the NFT gift you’re about to claim. Write it down before we add it to your wallet.',
          onDone: () => resolve(),
        }))
      }
      let giftNote: SellerNote | null = cvNote
      if (!giftNote) { try { giftNote = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref) } catch { /* best-effort */ } }
      setCvStatus('🎁 Claiming your free copy…')
      const claimed = await claimGiftEdition(provider, k, {
        giftWif: cvGiftWif, editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: giftNote ?? undefined,
      })
      storeEdition({ txId: claimed.replicaOutpoint.txId, outputIndex: claimed.replicaOutpoint.outputIndex, lockHex: claimed.lockHex },
        info.tx1Ref, info.name, tip.terms, giftNote)
      renderTokens()
      rememberGifter() // persist the gifter's Buy-BSV referral on this (often brand-new) wallet
      showViewButton(info, true)
      cvGiftWif = null // single-use — the voucher is now spent
      // Confirm it landed, then open the content.
      setCvStatus('✅ Added to your wallet — opening your gift…', 'ok')
      void onView(info.tx1Ref, info.name)
      return
    }

    // Price = the seller's actual price (v2: their set price split by %; v1: fixed fees).
    const publisherCut = tip.isV2 ? Math.floor((tip.priceSats * info.pBps) / 10000) : tip.terms.publisherFeeSats
    const resellerCut = tip.isV2 ? tip.priceSats - publisherCut : tip.terms.holderFeeSats
    const price = publisherCut + resellerCut
    // Confirm against the EXACT total (fees + refundable bond + network fee) — known only after the tx is
    // built, so confirmSpend gates the real spend, not just the fees. `approved` keeps a retry from re-asking.
    const bond = tip.tokenSats
    const priceDetail = tip.isV2
      ? `publisher ${(info.pBps / 100).toFixed(2)}% = ${publisherCut.toLocaleString()} + reseller ${resellerCut.toLocaleString()}`
      : `publisher ${publisherCut.toLocaleString()} + holder ${resellerCut.toLocaleString()}`
    let approved = false
    const confirmBuy = (totalSats: number): boolean => {
      if (approved) return true
      const showBond = bond > 1
      const networkFee = Math.max(0, totalSats - price - (showBond ? bond : 0))
      approved = confirm(
        `Buy a copy of “${info.name}”?\n\n` +
        `Seller's price:   ${price.toLocaleString()} sats  (${priceDetail})\n` +
        (showBond ? `Refundable bond:  ${bond.toLocaleString()} sats  (held in your copy — reclaim by burning)\n` : '') +
        `Network fee:      ${networkFee.toLocaleString()} sats\n` +
        `———————\n` +
        `Total to pay:     ${totalSats.toLocaleString()} sats\n\n` +
        `Instant, on-chain purchase.`)
      return approved
    }

    // Fund check: the buyer funds the price/fees + ONE bond (their replica, out[1]) + a miner-fee margin.
    // out[0]'s bond rides forward from the spent edition input, so it isn't funded by the buyer.
    const needed = price + tip.tokenSats + 1200
    const have = (await getSafeUtxos(provider)).reduce((s, u) => s + u.satoshis, 0)
    if (have < needed) { showFundPrompt(needed, have); return }
    hideFundPrompt()

    // The note (promo + bonus) to carry to my copy: the seller's resolved note, or (fallback) whatever rode in.
    let echoNote: SellerNote | null = cvNote
    if (!echoNote) {
      try { echoNote = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref) } catch { /* best-effort */ }
    }

    setCvStatus('Buying your copy — replicating the edition…')
    let bought: { txId: string; replicaOutpoint: { txId: string; outputIndex: number }; lockHex: string } | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        bought = tip.isV2
          ? await replicateEditionV2(provider, k, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: echoNote ?? undefined, confirmSpend: confirmBuy })
          : await replicateEdition(provider, k, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, terms: tip.terms, note: echoNote ?? undefined, confirmSpend: confirmBuy })
        break
      } catch (e) {
        if ((e as Error).message === SPEND_CANCELLED) throw e // user declined the spend — don't retry
        if (attempt === 2) throw e
        // The tip was likely taken by another buyer (double-spend) — re-resolve the seller's new edition and retry.
        setCvStatus('Another buyer was first — finding the seller’s new edition…')
        const again = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex })
        if (!again) throw new Error('the seller’s edition is no longer available')
        tip = again
      }
    }
    if (!bought) return
    // The buyer's replica (out[1]) is now ours — track it with the note + bonus that rode in on the purchase.
    storeEdition({ txId: bought.replicaOutpoint.txId, outputIndex: bought.replicaOutpoint.outputIndex, lockHex: bought.lockHex },
      info.tx1Ref, info.name, tip.terms, echoNote)
    renderTokens()
    showViewButton(info, true) // you're a holder now — keep a persistent View button on the page
    showBonus(echoNote, true)  // flip any bonus teaser to a live claim
    setCvStatus(
      `✅ You own a copy of “${info.name}”! Tx ${short(bought.txId)} — it’s now in your wallet.` +
      (echoNote?.text ? `\n📝 Seller’s note: ${echoNote.text}` : '') +
      (echoNote?.bonusValue ? '\n🎁 Bonus included — claim it below / on the NFT card.' : ''),
    )
    // Reveal the content (decrypts automatically — you're a holder now).
    if (info.hasContentFile) void onView(info.tx1Ref, info.name)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === SPEND_CANCELLED) { setCvStatus('Purchase cancelled — nothing was spent.'); return }
    setCvStatus(`Could not complete the purchase: ${msg}`, 'error')
  } finally {
    buying = false
    // Reflect ownership rather than blindly re-enabling: after a successful buy the wallet now holds a copy, so
    // the buttons ghost to "✓ You own a copy" (no accidental second purchase); on cancel/failure they re-enable.
    reflectCvOwnership(info)
  }
}

/** Publisher: broadcast a public announcement to all holders of a collection (one tx, pull-delivered). */
async function onBroadcast(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  const text = prompt(`Announce to all holders of “${t.collectionName ?? 'this collection'}”.\n\nPublic, one transaction, reaches every current holder. Message:`)
  if (text == null) return
  const trimmed = text.trim()
  if (!trimmed) { setStatus('Announcement was empty.', 'error'); return }
  setStatus('Publishing announcement to holders…')
  try {
    const txId = await publishBroadcast(provider, k, t.collectionId, trimmed, getMyAlias())
    latestBroadcast.set(t.collectionId, { text: trimmed, txId, height: 0 })
    renderTokens()
    setStatus(`📣 Announcement published (${short(txId)}). Holders see it when they check Updates.`, 'ok')
  } catch (e) {
    setStatus(`Broadcast failed: ${(e as Error).message}`, 'error')
  }
}

/** Any holder: create N pre-funded free-gift links for a collection (each single-use). Resellers can gift too;
 *  their net cost per claim is higher (they pre-pay the publisher's cut, which doesn't return to them). */
async function onGiftCopies(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  // Per-voucher funding = the recipient's replica BOND + the claim's price/fees + miner fee + a small starter.
  // What RETURNS on a claim differs by role: the publisher gets price + fees back (net ≈ bond + miner fee); a
  // reseller gets only their own share back, so they additionally eat the publisher's cut.
  let claimCost = 0, publisherCut = 0
  try {
    const ed = parseEditionAny(LockingScript.fromHex(t.lockHex ?? ''))
    if (ed) {
      claimCost = ed.isV2 ? ed.priceSats : (ed.terms.publisherFeeSats + ed.terms.holderFeeSats)
      publisherCut = ed.isV2 ? Math.floor((ed.priceSats * ed.terms.pBps) / 10000) : ed.terms.publisherFeeSats
    }
  } catch { /* leave 0 */ }
  const bond = t.tokenSats ?? EDITION_BOND_SATS // unknown → assume the default (over-funding a voucher is harmless; under-funding fails the claim)
  const MINER = 700
  const fundEach = bond + claimCost + MINER + 800 /* recipient starter */
  const iAmPublisher = t.publisherPubKeyHashHex != null && t.publisherPubKeyHashHex === myPubKeyHash()
  const netEach = bond + MINER + (iAmPublisher ? 0 : publisherCut) // settled net once a gift is claimed
  const roleLine = iAmPublisher
    ? `You're the publisher: your price + fees return on each claim, so a claimed gift nets ≈ ${netEach.toLocaleString()} sats (the ${bond.toLocaleString()}-sat bond moves to the recipient, + miner fee).`
    : `As a reseller: your share returns, but the publisher's ${publisherCut.toLocaleString()}-sat cut and the ${bond.toLocaleString()}-sat bond don't — so a claimed gift nets ≈ ${netEach.toLocaleString()} sats (think of it as marketing spend).`
  const countStr = prompt(
    `Create free-gift links for “${t.collectionName ?? 'this collection'}”.\n\n` +
    `How many?  Each voucher is pre-funded with ~${fundEach.toLocaleString()} sats now; unclaimed links are fully recoverable via “♻ Reclaim gifts”.\n\n${roleLine}`, '10')
  if (countStr == null) return
  const count = Math.max(1, Math.min(500, parseInt(countStr, 10) || 0))
  const total = count * fundEach
  if (!confirm(
    `Fund ${count} gift link(s):\n` +
    `• ~${total.toLocaleString()} sats locked now (recoverable if unclaimed)\n` +
    `• net ≈ ${(count * netEach).toLocaleString()} sats once all ${count} are claimed\n\nProceed?`)) return
  setStatus(`Creating ${count} funded gift link(s)…`)
  try {
    // Deterministic keys: scan for the next free index so a new batch doesn't collide with existing vouchers.
    const { nextIndex } = await scanGiftVouchers(provider, k, t.collectionId)
    const { fundingTxId, voucherWifs } = await createGiftVouchers(provider, k, { tx1RefHex: t.collectionId, startIndex: nextIndex, count, fundEachSats: fundEach })
    const giftBase = await shortShareBase(t.collectionId, pubKeyHex)
    const links = voucherWifs.map(wif => giftBase ? `${giftBase}#g=${wif}` : collectionShareUrl(t.collectionId, pubKeyHex, wif))
    setStatus(`✅ ${count} gift link(s) funded (tx ${short(fundingTxId)}). Recover them anytime with "Gift links".`, 'ok')
    showGiftLinksModal(t.collectionName ?? 'Free gift', links)
  } catch (e) {
    setStatus(`Gift creation failed: ${(e as Error).message}`, 'error')
  }
}

/** Recover this collection's UNCLAIMED gift links from your key + chain (deterministic vouchers), and re-show
 *  them — so you never lose access to links you didn't save. */
async function onViewGiftLinks(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return // voucher keys derive from the wallet key
  setStatus('Recovering your gift links from chain…')
  try {
    const scan = await scanGiftVouchers(provider, k, t.collectionId)
    const giftBase = await shortShareBase(t.collectionId, pubKeyHex)
    const links = scan.live.map(v => giftBase ? `${giftBase}#g=${v.wif}` : collectionShareUrl(t.collectionId, pubKeyHex, v.wif))
    if (links.length === 0) {
      setStatus(scan.claimedCount > 0
        ? `No unclaimed gift links left — all ${scan.claimedCount} have been claimed.`
        : 'No gift links found for this collection yet.', 'info')
      return
    }
    showGiftLinksModal(t.collectionName ?? 'Gift links', links)
    setStatus(`Recovered ${links.length} unclaimed gift link(s)${scan.claimedCount > 0 ? ` (${scan.claimedCount} already claimed)` : ''}.`, 'ok')
  } catch (e) {
    setStatus(`Recover gift links failed: ${(e as Error).message}`, 'error')
  }
}

/** Any holder: reclaim UNCLAIMED gift links — sweep their pre-funded sats back to your wallet (invalidating
 *  those links). Already-claimed gifts are untouched. */
async function onReclaimGifts(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  setStatus('Scanning for unclaimed gift links…')
  let scan
  try { scan = await scanGiftVouchers(provider, k, t.collectionId) }
  catch (e) { setStatus(`Scan failed: ${(e as Error).message}`, 'error'); return }
  if (scan.live.length === 0) {
    setStatus(scan.claimedCount > 0 ? `Nothing to reclaim — all ${scan.claimedCount} gift links were claimed.` : 'No unclaimed gift links to reclaim.', 'ok')
    return
  }
  if (!confirm(
    `Reclaim ${scan.live.length} UNCLAIMED gift link${scan.live.length > 1 ? 's' : ''} for “${t.collectionName ?? 'this collection'}”?\n\n` +
    `This INVALIDATES those links and returns their pre-funded sats to your wallet (minus the network fee). ` +
    `Already-claimed gifts are unaffected.`)) return
  setStatus('Reclaiming unclaimed gifts…')
  try {
    const r = await sweepGiftVouchers(provider, k, scan.live)
    if (r == null) { setStatus('Nothing to reclaim — the links may have just been claimed.', 'ok'); return }
    setStatus(`♻ Reclaimed ${r.swept} unclaimed gift${r.swept > 1 ? 's' : ''} — ${r.reclaimedSats.toLocaleString()} sats back to your wallet. Tx ${short(r.txId)}.`, 'ok')
    void refreshBalance()
  } catch (e) {
    setStatus(`Reclaim failed: ${(e as Error).message}`, 'error')
  }
}

/** Show the generated gift links: bulk copy/download + a per-link QR for in-person handouts. */
function showGiftLinksModal(title: string, links: string[]): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal'
  const rows = links.map((l, i) =>
    `<div class="gift-row"><span class="mono gift-link">${escapeHtml(l)}</span>` +
    `<button class="secondary gift-qr" data-i="${i}">QR</button></div>`).join('')
  overlay.innerHTML =
    '<div class="modal-box gift-modal-box">' +
    `<div class="modal-head"><span>🎁 ${escapeHtml(title)} — ${links.length} gift link${links.length > 1 ? 's' : ''}</span>` +
    '<button class="secondary gift-close">✕ Close</button></div>' +
    '<div class="row" style="margin-bottom:10px"><button class="gift-copyall">Copy all</button>' +
    '<button class="secondary gift-download">Download .txt</button></div>' +
    `<div class="gift-list">${rows}</div>` +
    '<p class="muted" style="font-size:11px;margin-top:10px">Each link is single-use and pre-funded. Hand them out (email, DM, in person); the recipient claims a free copy and can resell it — your publisher fee returns on every resale.</p>' +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.gift-close')?.addEventListener('click', close)
  overlay.querySelector('.gift-copyall')?.addEventListener('click', () => void navigator.clipboard?.writeText(links.join('\n')))
  overlay.querySelector('.gift-download')?.addEventListener('click', () => {
    const blob = new Blob([links.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'smart-nfts-gift-links.txt'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  overlay.querySelectorAll('.gift-qr').forEach(b => b.addEventListener('click', () => {
    showQrModal('Scan to claim a free copy', links[parseInt((b as HTMLElement).dataset.i ?? '0', 10)])
  }))
  document.body.append(overlay)
}

/** Publisher: scan your address history for sales of this collection and list the buyers (each DM-able). */
async function onViewBuyers(t: StoredToken): Promise<void> {
  if (t.publisherPubKeyHashHex == null) return
  const title = t.collectionName ?? 'Collection'
  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box gift-modal-box">' +
    `<div class="modal-head"><span>👥 Buyers of ${escapeHtml(title)}</span>` +
    '<span class="row" style="gap:6px"><button class="secondary buyers-refresh">🔄 Refresh</button>' +
    '<button class="secondary buyers-close">✕ Close</button></span></div>' +
    '<p class="buyers-status muted" style="font-size:12px">Scanning your sales…</p>' +
    '<div class="buyers-toolbar" hidden><label class="buyers-selall"><input type="checkbox" class="buyers-all" /> Select all</label>' +
    '<button class="buyers-msg-sel" disabled>✉ Message selected (0)</button></div>' +
    '<div class="buyers-list"></div>' +
    '<p class="muted" style="font-size:11px;margin-top:10px">Buyers at point of sale (when they replicated a copy). Onward transfers aren’t visible to you, so this isn’t a current-owner list.</p>' +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.buyers-close')?.addEventListener('click', close)
  document.body.append(overlay)

  const statusEl = overlay.querySelector('.buyers-status') as HTMLElement
  const listEl = overlay.querySelector('.buyers-list') as HTMLElement
  const refreshBtn = overlay.querySelector('.buyers-refresh') as HTMLButtonElement
  const toolbarEl = overlay.querySelector('.buyers-toolbar') as HTMLElement
  const allEl = overlay.querySelector('.buyers-all') as HTMLInputElement
  const msgSelBtn = overlay.querySelector('.buyers-msg-sel') as HTMLButtonElement
  const selected = new Set<string>()
  let lastBuyers: BuyerRecord[] = []
  const updateSelUI = (): void => {
    msgSelBtn.disabled = selected.size === 0
    msgSelBtn.textContent = `✉ Message selected (${selected.size})`
    allEl.checked = lastBuyers.length > 0 && lastBuyers.every(b => selected.has(b.pubKeyHex))
  }
  const render = (res: { buyers: BuyerRecord[]; scanned: number; capped: boolean }): void => {
    lastBuyers = res.buyers
    if (res.buyers.length === 0) {
      statusEl.textContent = `No buyers yet — no one has replicated a copy (scanned ${res.scanned} tx${res.scanned === 1 ? '' : 's'}).`
      toolbarEl.hidden = true
      return
    }
    statusEl.textContent = `${res.buyers.length} buyer${res.buyers.length > 1 ? 's' : ''}${res.capped ? ` · most recent ${res.scanned} txs` : ''}`
    toolbarEl.hidden = false
    listEl.innerHTML = ''
    for (const b of res.buyers) {
      const row = document.createElement('div'); row.className = 'buyer-row'
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'buyer-sel'; cb.checked = selected.has(b.pubKeyHex)
      cb.onchange = () => { if (cb.checked) selected.add(b.pubKeyHex); else selected.delete(b.pubKeyHex); updateSelUI() }
      const who = document.createElement('div'); who.className = 'buyer-who'
      who.innerHTML = `${nameChip(b.pubKeyHex)}${b.count > 1 ? ` <span class="muted">×${b.count}</span>` : ''}`
      const msg = document.createElement('button'); msg.className = 'secondary'; msg.textContent = '✉ Message'
      msg.onclick = () => composeTo(b.pubKeyHex, 'this buyer', { product: title, recipientRole: 'buyer' }) // stacks over the list
      row.append(cb, who, msg)
      listEl.append(row)
    }
    updateSelUI()
  }
  allEl.onchange = () => {
    if (allEl.checked) lastBuyers.forEach(b => selected.add(b.pubKeyHex)); else selected.clear()
    listEl.querySelectorAll('.buyer-sel').forEach((cb, i) => { (cb as HTMLInputElement).checked = selected.has(lastBuyers[i].pubKeyHex) })
    updateSelUI()
  }
  msgSelBtn.onclick = () => { if (selected.size) openCompose([...selected], { who: `${selected.size} buyers`, product: title, recipientRole: 'buyer' }) }
  const scan = async (): Promise<void> => {
    refreshBtn.disabled = true; listEl.innerHTML = ''; statusEl.textContent = 'Scanning your sales…'
    try {
      const res = await scanCollectionBuyers(provider, {
        collectionId: t.collectionId,
        publisherPubKeyHashHex: t.publisherPubKeyHashHex!,
        onProgress: (done, total) => { statusEl.textContent = `Scanning your sales… ${done}/${total}` },
      })
      render(res)
      if (res.buyers.length) resolveAvatarsThen(res.buyers.map(b => b.pubKeyHex), () => { if (document.body.contains(overlay)) render(res) })
    } catch (e) {
      statusEl.textContent = `Scan failed: ${(e as Error).message}`
    } finally {
      refreshBtn.disabled = false
    }
  }
  refreshBtn.onclick = () => void scan()
  await scan()
}

/** 📊 Sales dashboard: one scan of your address history → all your sales, both as creator (every sale of a
 *  collection you publish) and as reseller (your direct resales), grouped per collection. */
// ─── Sales tab (stats + breakdown) ──────────────────────────────────
let salesCache: MySales | null = null
let salesHeight = 0
const salesNames = new Map<string, string>()
const BLOCKS_PER_DAY = 144

const fmtBsv = (sats: number): string => (sats / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0'
// Scans whose exact gift check has finished — until a scan is in here the Gifts tile shows "…" (not a bogus 0).
const giftsDone = new WeakSet<MySales>()

/** The pubkey-hash (hex, lc) that a P2PKH input's scriptSig unlocks with — its trailing push is the pubkey.
 *  Lets us read a funding key straight from the signature, no source-output lookup. null if not a P2PKH spend. */
function p2pkhInputPubKeyHash(input: { unlockingScript?: { chunks: Array<{ data?: number[] }> } }): string | null {
  try {
    const chunks = input.unlockingScript?.chunks
    if (chunks == null || chunks.length < 2) return null
    const pub = chunks[chunks.length - 1].data
    if (pub == null || (pub.length !== 33 && pub.length !== 65)) return null
    return Utils.toHex(Hash.hash160(pub)).toLowerCase()
  } catch { return null }
}

/** Render the Sales tab. Reuses the last scan unless `force` (or first visit) — the scan is the expensive bit. */
async function renderSalesTab(force = false): Promise<void> {
  const statsEl = $('salesStats'); const statusEl = $('salesStatus'); const bodyEl = $('salesBody')
  const refreshBtn = $('btnSalesRefresh') as HTMLButtonElement
  if (salesCache != null && !force) { paintSales(salesCache, salesHeight); return }
  refreshBtn.disabled = true; statsEl.innerHTML = ''; bodyEl.innerHTML = ''; statusEl.textContent = 'Scanning your sales…'
  try {
    const height = await provider.getChainHeight().catch(() => 0)
    const res = await scanMySales(provider, { myPubKeyHex: pubKeyHex, myHash: myPubKeyHash(),
      onProgress: (d, t) => { statusEl.textContent = `Scanning your sales… ${d}/${t}` } })
    salesCache = res; salesHeight = height
    const cids = [...new Set(res.sales.map(s => s.collectionId))]
    await Promise.all(cids.map(async c => { if (!salesNames.has(c)) { try { salesNames.set(c, await resolveCollectionName(c)) } catch { salesNames.set(c, short(c)) } } }))
    paintSales(res, height)
    void fillGiftStats(res, height) // background: exactly tag which sales were gift claims, then repaint
    const keys = res.sales.map(s => s.buyerPubKeyHex)
    if (keys.length) resolveAvatarsThen(keys, () => { if (salesCache === res) paintSales(res, height) })
  } catch (e) { statusEl.textContent = `Scan failed: ${(e as Error).message}` } finally { refreshBtn.disabled = false }
}

function statTile(label: string, value: string, sub: string): string {
  return `<div class="stat-tile"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-val">${value}</div><div class="stat-sub muted">${escapeHtml(sub)}</div></div>`
}

function paintSales(res: MySales, height: number): void {
  const statsEl = $('salesStats'); const statusEl = $('salesStatus'); const bodyEl = $('salesBody')
  // Approximate "this month" by block-height delta (unconfirmed counts as recent).
  const monthFloor = height > 0 ? height - 30 * BLOCKS_PER_DAY : 0
  const inMonth = (h: number): boolean => height === 0 || h === 0 || h >= monthFloor
  const S = res.sales // de-duplicated: one row per real sale, so no double-count across creator/reseller roles
  const earnOf = (x: UnifiedSale): number => x.publisherFeeSats + x.holderFeeSats
  const earned = S.reduce((s, x) => s + earnOf(x), 0)
  const earnedMonth = S.filter(x => inMonth(x.height)).reduce((s, x) => s + earnOf(x), 0)
  const salesMonth = S.filter(x => inMonth(x.height)).length
  const uniqueBuyers = new Set(S.map(x => x.buyerPubKeyHex.toLowerCase())).size
  const top = res.asCreator[0] ?? res.asReseller[0]
  const noHeight = height === 0
  const monthLbl = noHeight ? 'period n/a' : 'this month'

  // A gift claim cycles your OWN pre-funded voucher money back as "fees", so it's not real revenue. Once the
  // background gift-tagging finishes we can subtract those for a true "Net revenue". Both stats show "…" until
  // then, and "—" in watch-only mode (no key → can't detect which sales were gift-funded).
  const giftsKnown = giftsDone.has(res)
  const giftCount = giftsKnown ? S.filter(s => s.isGift).length : 0
  const giftEarned = giftsKnown ? S.filter(s => s.isGift).reduce((s, x) => s + earnOf(x), 0) : 0
  const netEarned = earned - giftEarned // gifts excluded
  const giftVal = !giftsKnown ? '<span class="muted">…</span>' : key == null ? '—' : String(giftCount)
  const netVal = key == null ? '—'
    : !giftsKnown ? '<span class="muted">…</span>'
    : `${netEarned.toLocaleString()} <span class="stat-unit">sat</span>`
  const netSub = !giftsKnown ? 'gifts excluded — checking…'
    : giftCount === 0 ? 'no gift claims — same as earned'
    : `${fmtBsv(netEarned)} BSV · excl. ${giftCount} gift claim${giftCount === 1 ? '' : 's'} (−${giftEarned.toLocaleString()} sat)`
  statsEl.innerHTML = '<div class="stat-grid">' +
    statTile('Sales', String(S.length), `${salesMonth} ${monthLbl}`) +
    statTile('Earned', `${earned.toLocaleString()} <span class="stat-unit">sat</span>`, `${fmtBsv(earned)} BSV · ${earnedMonth.toLocaleString()} sat ${monthLbl}`) +
    statTile('Net revenue', netVal, netSub) +
    statTile('Unique buyers', String(uniqueBuyers), top != null ? `top: ${escapeHtml(salesNames.get(top.collectionId) ?? short(top.collectionId))}` : 'across your sales') +
    statTile('Gifts', giftVal, 'claimed via gift links') +
    '</div>'
  statusEl.textContent = `${S.length} sale${S.length === 1 ? '' : 's'}${res.capped ? ` · most recent ${res.scanned} txs` : ''}${noHeight ? ' · block height unavailable, periods approximate' : ''}`
  bodyEl.innerHTML = ''
  bodyEl.append(salesUnified(S, salesNames))
}

/** One de-duplicated list of sales, grouped by collection — each purchase shown ONCE, with its date and which
 *  fees you earned (both / publisher-only / holder-only). Replaces the old overlapping creator+reseller sections. */
function salesUnified(sales: UnifiedSale[], names: Map<string, string>): HTMLElement {
  const sec = document.createElement('div'); sec.className = 'token-section'
  const head = document.createElement('div'); head.className = 'token-section-head'; head.style.cursor = 'default'
  head.innerHTML = '<span class="token-section-label">🧾 Your sales — each purchase once, with what you earned</span>' + ` <span class="count">${sales.length}</span>`
  sec.append(head)
  if (sales.length === 0) {
    const p = document.createElement('p'); p.className = 'muted'; p.style.fontSize = '12px'; p.textContent = 'No sales yet.'; sec.append(p); return sec
  }
  const byCol = new Map<string, UnifiedSale[]>()
  for (const s of sales) { const a = byCol.get(s.collectionId) ?? []; a.push(s); byCol.set(s.collectionId, a) }
  const groups = [...byCol.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [cid, list] of groups) {
    const name = names.get(cid) ?? short(cid)
    const groupEarned = list.reduce((s, x) => s + x.publisherFeeSats + x.holderFeeSats, 0)
    const buyerKeys = new Map<string, string>() // lc -> original key, to de-dupe buyers for "message all"
    for (const s of list) if (!buyerKeys.has(s.buyerPubKeyHex.toLowerCase())) buyerKeys.set(s.buyerPubKeyHex.toLowerCase(), s.buyerPubKeyHex)
    const uniq = [...buyerKeys.values()]
    const card = document.createElement('div'); card.className = 'sales-group'
    const giftN = list.filter(s => s.isGift).length
    const gh = document.createElement('button'); gh.type = 'button'; gh.className = 'sales-group-head'
    gh.innerHTML = `<span class="chev">▸</span> <span class="sales-group-name">${escapeHtml(name)}</span>` +
      `<span class="sales-group-meta">${list.length} sale${list.length === 1 ? '' : 's'} · ${uniq.length} buyer${uniq.length === 1 ? '' : 's'} · ${groupEarned.toLocaleString()} sat${giftN > 0 ? ` · <span class="gift-badge">🎁 ${giftN} gifted</span>` : ''}</span>`
    const body = document.createElement('div'); body.className = 'buyers-list'; body.hidden = true
    const msgAll = document.createElement('button'); msgAll.className = 'secondary'; msgAll.style.margin = '6px 0'
    msgAll.textContent = `✉ Message all ${uniq.length}`
    msgAll.onclick = () => openCompose(uniq, { who: `${uniq.length} buyer${uniq.length === 1 ? '' : 's'}`, product: name, recipientRole: 'buyer' })
    body.append(msgAll)
    for (const s of [...list].sort((a, b) => (b.time || b.height || 0) - (a.time || a.height || 0))) {
      const row = document.createElement('div'); row.className = 'buyer-row'
      const who = document.createElement('div'); who.className = 'buyer-who'
      const date = s.time ? new Date(s.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : (s.height ? '' : 'pending')
      const amt = s.publisherFeeSats + s.holderFeeSats
      const kind = s.publisherFeeSats > 0 && s.holderFeeSats > 0 ? 'both fees' : s.publisherFeeSats > 0 ? 'publisher fee' : 'holder fee'
      who.innerHTML = `${nameChip(s.buyerPubKeyHex)} <span class="sale-tag muted">${date ? escapeHtml(date) + ' · ' : ''}${kind} · +${amt.toLocaleString()} sat</span>${s.isGift ? ' <span class="gift-badge">🎁 gift</span>' : ''}`
      const msg = document.createElement('button'); msg.className = 'secondary'; msg.textContent = '✉ Message'
      msg.onclick = () => composeTo(s.buyerPubKeyHex, 'this buyer', { product: name, recipientRole: 'buyer' })
      row.append(who, msg); body.append(row)
    }
    gh.onclick = () => { body.hidden = !body.hidden; gh.querySelector('.chev')!.textContent = body.hidden ? '▸' : '▾' }
    card.append(gh, body); sec.append(card)
  }
  return sec
}

/** Background: tag EXACTLY which sales were gift claims, then repaint. A claim is funded by one of the
 *  collection's gift vouchers, so we derive that collection's funded voucher hashes (bounded by how many links
 *  you ever made) and check each sale's funding input against them — a sweep/reclaim never funds a sale, so it's
 *  correctly excluded. Only your published collections have your vouchers. Best-effort; skipped when watch-only. */
async function fillGiftStats(res: MySales, height: number): Promise<void> {
  if (key != null) {
    const byCid = new Map<string, UnifiedSale[]>()
    for (const s of res.sales) if (s.publisherFeeSats > 0) { const a = byCid.get(s.collectionId) ?? []; a.push(s); byCid.set(s.collectionId, a) }
    for (const [cid, list] of byCid) {
      let hashes: Set<string>
      try { hashes = await scanVoucherHashes(provider, key, cid) } catch { continue }
      if (hashes.size === 0) continue // no gift links for this collection → none of its sales are gifts
      await Promise.all(list.map(async s => {
        try {
          const tx = await provider.getSourceTransaction(s.txId) // the small replicate tx (never content)
          for (let i = 1; i < tx.inputs.length; i++) { // input[0] = the edition being cloned; funding follows
            const pkh = p2pkhInputPubKeyHash(tx.inputs[i])
            if (pkh != null && hashes.has(pkh)) { s.isGift = true; break }
          }
        } catch { /* best-effort — leave untagged */ }
      }))
    }
  }
  if (salesCache !== res) return // a newer scan superseded this one
  giftsDone.add(res)
  paintSales(res, height) // repaint with exact 🎁 labels + the true gift count
}

// ─── discussions (lineage corridors) ────────────────────────────────
let discAnchor: StoredToken | null = null // the held edition whose corridor is currently open

/** One room per held EDITION collection (corridors are a lineage/replication feature); first held copy anchors it. */
function discRooms(): StoredToken[] {
  const seen = new Set<string>(); const rooms: StoredToken[] = []
  for (const t of store.active()) {
    if (t.kind !== 'edition' || seen.has(t.collectionId)) continue
    seen.add(t.collectionId); rooms.push(t)
  }
  return rooms
}

function renderDiscRooms(): void {
  const host = $('discRooms'); const thread = $('discThread')
  discAnchor = null; thread.hidden = true; thread.innerHTML = ''; host.hidden = false
  const rooms = discRooms()
  if (rooms.length === 0) { host.innerHTML = '<p class="muted">No discussions yet — hold or publish an edition to join its lineage corridor.</p>'; return }
  host.innerHTML = ''
  for (const t of rooms) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'disc-room'
    row.innerHTML = `<span class="disc-room-name">${escapeHtml(t.collectionName ?? 'Collection')}</span><span class="disc-room-meta">enter ▸</span>`
    row.onclick = () => void openDiscRoom(t)
    host.append(row)
  }
}

async function openDiscRoom(t: StoredToken): Promise<void> {
  discAnchor = t
  const host = $('discRooms'); const thread = $('discThread')
  host.hidden = true; thread.hidden = false
  thread.innerHTML =
    `<div class="disc-head"><button class="secondary disc-back">← Rooms</button><h3>${escapeHtml(t.collectionName ?? 'Collection')}</h3><button class="secondary disc-reload">🔄</button></div>` +
    '<div class="disc-compose"><textarea class="disc-text" rows="3" placeholder="Post to your line…"></textarea>' +
    '<div class="disc-compose-row"><label class="muted" style="font-size:12px">Post to <select class="disc-target"></select></label>' +
    '<button class="disc-send">Post</button><span class="disc-status muted" style="font-size:12px"></span></div></div>' +
    '<div class="disc-feed"><p class="muted">Loading corridor…</p></div>'
  thread.querySelector('.disc-back')!.addEventListener('click', () => renderDiscRooms())
  thread.querySelector('.disc-reload')!.addEventListener('click', () => void loadDiscThread(t))
  await loadDiscThread(t)
}

async function loadDiscThread(t: StoredToken): Promise<void> {
  const thread = $('discThread')
  const feedEl = thread.querySelector('.disc-feed') as HTMLElement
  const targetEl = thread.querySelector('.disc-target') as HTMLSelectElement
  const sendBtn = thread.querySelector('.disc-send') as HTMLButtonElement
  const textEl = thread.querySelector('.disc-text') as HTMLTextAreaElement
  const statusEl = thread.querySelector('.disc-status') as HTMLElement
  sendBtn.disabled = false // re-enable on every (re)load — a prior successful post left it disabled
  feedEl.innerHTML = '<p class="muted">Loading corridor…</p>'
  const iAmPublisher = t.publisherPubKeyHashHex === myPubKeyHash()
  let result: { nodes: CorridorNode[]; posts: Array<DiscPost & { node: CorridorNode }> }
  try { result = await readCorridor(provider, t.txId, t.outputIndex, t.collectionId, { rootDownstream: iAmPublisher }) }
  catch (e) { feedEl.innerHTML = `<p class="muted">Couldn’t load this corridor: ${escapeHtml((e as Error).message)}</p>`; return }
  // Post targets: your line (self) + reply to any upline; the publisher can also post to everyone (root).
  const opts: Array<{ node: CorridorNode; label: string }> = []
  const selfNode = result.nodes.find(n => n.isSelf)
  if (selfNode) opts.push({ node: selfNode, label: 'your line' })
  for (const n of result.nodes) {
    if (n.isRoot) { if (iAmPublisher) opts.push({ node: n, label: '📣 everyone (collection)' }); continue }
    if (!n.isSelf) opts.push({ node: n, label: `⬆ reply to ${displayName(n.ownerPubKeyHex).name}` })
  }
  targetEl.innerHTML = opts.map((o, i) => `<option value="${i}">${escapeHtml(o.label)}</option>`).join('')
  sendBtn.onclick = () => void (async () => {
    const k = requireKey(); if (k == null) return
    const text = textEl.value.trim()
    if (text === '') { statusEl.textContent = 'Write something first.'; return }
    const target = opts[parseInt(targetEl.value || '0', 10)]?.node
    if (target == null) { statusEl.textContent = 'No post target available.'; return }
    // Drop a downstream breadcrumb on every node ABOVE the target (its ancestors in the corridor) so they
    // discover this post; root is included, giving the publisher the whole-tree view.
    const targetIdx = result.nodes.indexOf(target)
    const downBreadcrumbs = result.nodes.slice(0, targetIdx < 0 ? 0 : targetIdx).map(n => n.downHash160)
    sendBtn.disabled = true; statusEl.textContent = 'Posting…'
    try {
      await postToNodeFeed(provider, k, { feedHash160: target.feedHash160, ref: target.ref, text, senderAlias: getMyAlias(), downBreadcrumbs })
      textEl.value = ''; statusEl.textContent = '✅ Posted.'
      setTimeout(() => { if (discAnchor === t) void loadDiscThread(t) }, 900)
    } catch (e) { statusEl.textContent = `Post failed: ${(e as Error).message}`; sendBtn.disabled = false }
  })()
  const ctx = { nodes: result.nodes, publisherHash: t.publisherPubKeyHashHex?.toLowerCase() }
  renderDiscFeed(feedEl, result.posts, ctx)
  if (result.posts.length) resolveAvatarsThen(result.posts.map(p => p.authorPubKeyHex), () => { if (discAnchor === t) renderDiscFeed(feedEl, result.posts, ctx) })
}

/** Un-spoofable identity badge for a post author, derived from lineage: 👑 creator (author hashes to the
 *  covenant's publisher key), 🌱 original holder (a genesis node owner), ✓ holder (a resolved corridor owner). */
function discIdentityBadge(authorPubKeyHex: string, ctx: { nodes: CorridorNode[]; publisherHash?: string }): string {
  const a = authorPubKeyHex.toLowerCase()
  try {
    if (ctx.publisherHash != null && Utils.toHex(Hash.hash160(Utils.toArray(authorPubKeyHex, 'hex'))) === ctx.publisherHash) {
      return '<span class="disc-badge creator" title="Verified creator — this key controls the collection’s covenant">👑 creator</span>'
    }
  } catch { /* malformed key — no badge */ }
  const owned = ctx.nodes.find(n => n.ownerPubKeyHex !== '' && n.ownerPubKeyHex.toLowerCase() === a)
  if (owned != null) return owned.isGenesis
    ? '<span class="disc-badge senior" title="Original holder — owns a genesis copy">🌱 original holder</span>'
    : '<span class="disc-badge senior" title="Verified holder in this lineage">✓ holder</span>'
  return ''
}

function renderDiscFeed(feedEl: HTMLElement, posts: Array<DiscPost & { node: CorridorNode }>, ctx: { nodes: CorridorNode[]; publisherHash?: string }): void {
  if (posts.length === 0) { feedEl.innerHTML = '<p class="muted">No posts yet — be the first to post to your line.</p>'; return }
  feedEl.innerHTML = ''
  for (const p of posts) {
    const pos = p.node.isDownstream ? '<span class="disc-badge down">⬇ downline</span>'
      : p.node.isRoot ? '<span class="disc-badge root">📣 everyone</span>'
      : p.node.isSelf ? '<span class="disc-badge self">your line</span>'
      : '<span class="disc-badge up">⬆ upline</span>'
    const el = document.createElement('div'); el.className = 'disc-post'
    el.innerHTML =
      `<div class="disc-post-head">${nameChip(p.authorPubKeyHex)} ${discIdentityBadge(p.authorPubKeyHex, ctx)} ${pos}${p.sentAt ? ` · 🕒 ${escapeHtml(fmtTime(p.sentAt))}` : ''}</div>` +
      `<div class="disc-post-text">${escapeHtml(p.text)}</div>`
    feedEl.append(el)
  }
}

/** Holder: pull announcements from the publishers of every collection you hold → newest-first feed. */
async function onCheckUpdates(): Promise<void> {
  const host = $('updatesFeed')
  const held = [...new Set(store.active().map(t => t.collectionId))]
  if (held.length === 0) {
    host.innerHTML = '<p class="muted">No collections held yet — buy or mint an edition to receive publisher updates.</p>'
    return
  }
  host.innerHTML = '<p class="muted">Checking for updates…</p>'
  const feed: UpdateItem[] = []
  for (const collectionId of held) {
    try {
      const info = await loadCollection(collectionId)
      if (!info.publisherPubKeyHex) continue
      const list = await resolveBroadcasts(provider, info.publisherPubKeyHex, collectionId)
      if (list.length > 0) latestBroadcast.set(collectionId, list[0])
      for (const b of list) feed.push({ ...b, name: info.name, publisherPubKeyHex: info.publisherPubKeyHex })
    } catch { /* skip a collection that fails to load */ }
  }
  feed.sort((a, b) => (b.height || 1e12) - (a.height || 1e12)) // newest first; unconfirmed → top
  applyLatestAliases(feed.map(b => ({ pk: b.publisherPubKeyHex, alias: b.senderAlias }))) // newest broadcast's @name per publisher
  renderTokens() // surface any newly-cached latest announcements inline on the tokens
  renderUpdatesFeed(feed)
  resolveAvatarsThen(feed.map(b => b.publisherPubKeyHex), () => { if (lastUpdatesFeed != null) renderUpdatesFeed(lastUpdatesFeed) })
}

type UpdateItem = Broadcast & { name: string; publisherPubKeyHex: string }

function renderUpdatesFeed(feed: UpdateItem[]): void {
  lastUpdatesFeed = feed
  const host = $('updatesFeed')
  if (feed.length === 0) {
    host.innerHTML = '<p class="muted">No announcements yet from the publishers of your collections.</p>'
    return
  }
  host.innerHTML = feed.map(b =>
    `<div class="token msg"><div class="token-name">📣 ${escapeHtml(b.name || 'Collection')}</div>` +
    `<div class="mono" style="font-size:12px">by ${nameChip(b.publisherPubKeyHex, { save: true })}</div>` +
    `<div class="state" style="color:var(--accent);white-space:pre-wrap">${escapeHtml(b.text)}</div>` +
    `<div class="mono">${short(b.txId)}</div></div>`,
  ).join('')
}

/** Wire the wallet section tabs (show one panel at a time) and restore the last-viewed tab. */
/** Switch the active wallet tab (also reachable programmatically, e.g. "Message publisher" → Messages). */
function activateTab(name: string): void {
  // Watch-only: never land on a key-only tab (Publish / DMs) — fall back to the Wallet tab.
  const navBtn = document.querySelector(`.tab[data-tab="${name}"]`)
  if (isWatchOnly() && navBtn?.hasAttribute('data-needs-key')) name = 'wallet'
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name))
  document.querySelectorAll<HTMLElement>('.tabpanel').forEach(p => p.classList.toggle('is-active', p.id === `tab-${name}`))
  try { localStorage.setItem('p:activeTab', name) } catch { /* private mode — ignore */ }
  // Populate the Discussions room list on open (unless a room is already open, so a reload of the tab keeps it).
  if (name === 'discussions' && discAnchor == null) renderDiscRooms()
  if (name === 'sales') void renderSalesTab() // reuses the cached scan after the first visit
}

function initTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('.tab'))
  tabs.forEach(t => { t.onclick = () => activateTab(t.dataset.tab!) })
  // Home-page cards (and any other in-app shortcut) jump to a tab via data-goto.
  document.querySelectorAll<HTMLElement>('[data-goto]').forEach(el => {
    el.onclick = () => activateTab(el.dataset.goto!)
  })
  let saved: string | null = null
  try { saved = localStorage.getItem('p:activeTab') } catch { /* ignore */ }
  if (saved && tabs.some(t => t.dataset.tab === saved)) activateTab(saved)
}

function init(): void {
  store = new PharLapStore()
  const ver = $('appVersion'); if (ver != null) ver.textContent = `Smart NFTs · v${__APP_VERSION__} · ${__BUILD_ID__} · ${__BUILD_DATE__}`
  loadAliases() // before useKey(): renderWallet() draws your own avatar, which reads the loaded p:avatars cache
  const watch = localStorage.getItem(WATCH_KEY)
  if (watch != null) { try { useWatchKey(watch) } catch { localStorage.removeItem(WATCH_KEY); useKey(loadKey()) } }
  else useKey(loadKey())
  try { if (localStorage.getItem('p:nftview') === 'grid') nftView = 'grid' } catch { /* default list */ }
  try { if (localStorage.getItem('p:nftsort') === 'publisher') nftSort = 'publisher' } catch { /* default recent */ }
  updateViewToggle()
  updateSortToggle()
  renderTokens()
  initTabs()
  document.addEventListener('click', onCopyClick) // click-to-copy for any [data-copy] element
  document.addEventListener('click', onAliasSaveClick) // save a self-claimed alias to your contacts
  ;($('myAlias') as HTMLInputElement).value = getMyAlias() ? '@' + getMyAlias() : ''
  $('btnSaveAlias').onclick = () => {
    const a = val('myAlias').replace(/^@+/, '').trim()
    setMyAlias(a)
    ;($('myAlias') as HTMLInputElement).value = a ? '@' + a : ''
    toast(a ? `Your alias is now @${a}` : 'Alias cleared')
  }
  $('btnViewList').onclick = () => setNftView('list')
  $('btnViewGrid').onclick = () => setNftView('grid')
  $('btnSortRecent').onclick = () => setNftSort('recent')
  $('btnSortPublisher').onclick = () => setNftSort('publisher')
  $('btnDiscRefresh').onclick = () => { if (discAnchor != null) void loadDiscThread(discAnchor); else renderDiscRooms() }
  $('btnSales').onclick = () => activateTab('sales')
  $('btnSalesRefresh').onclick = () => void renderSalesTab(true)
  $('tokenModalClose').onclick = () => closeTokenModal()
  $('tokenModal').addEventListener('click', e => { if (e.target === $('tokenModal')) closeTokenModal() })
  // Any action button inside the detail modal navigates or mutates — hide the modal so it doesn't stack over
  // a viewer/storefront that the action opens (capture phase, hide-only, so the button's own handler still runs).
  $('tokenModalBody').addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button') != null) $('tokenModal').style.display = 'none'
  }, true)

  $('btnRefresh').onclick = () => void refreshBalance()
  $('btnBuyBsv').onclick = () => onBuyBsv()
  $('btnSaveAff').onclick = () => onSaveAff()
  renderAffField()
  wireScanButtons() // inject 📷 scan buttons beside [data-scan] inputs
  $('btnMint').onclick = () => void onMint()
  $('btnMintEdition').onclick = () => void onMintEdition()
  ;($('edCombine') as HTMLInputElement).onchange = () => {
    const on = ($('edCombine') as HTMLInputElement).checked
    $('edCombineWrap').hidden = !on
    // In combine mode the EP's content IS the reference manifest, so the file/encrypt inputs don't apply.
    ;($('edFile') as HTMLInputElement).disabled = on
    const enc = $('edEncrypt') as HTMLInputElement
    enc.disabled = on; if (on) enc.checked = false // disabling alone leaves .checked true — clear it
    if (on) renderCombinePicker()
  }
  ;($('edCover') as HTMLInputElement).onchange = () => void onCoverSelected()
  $('edCoverCam').onclick = () => void onTakePhoto()
  $('btnFeeFixed').onclick = () => setFeeMode('fixed')
  $('btnFeePct').onclick = () => setFeeMode('pct')
  ;($('edPrice') as HTMLInputElement).addEventListener('input', updateFeePctPreview)
  ;($('edResellerPct') as HTMLInputElement).addEventListener('input', updateFeePctPreview)
  ;($('edBond') as HTMLInputElement).addEventListener('input', updateFeePctPreview) // bond feeds the buyer-total preview
  $('btnIncoming').onclick = () => void onCheckIncoming()
  $('btnSendMessage').onclick = () => void onSendMessage()
  $('btnCheckMessages').onclick = () => void onCheckMessages()
  $('msgTo').addEventListener('input', updateMsgToName)
  $('btnContacts').onclick = () => openContactsModal()
  $('btnPublishProfile').onclick = () => void onPublishProfile()
  $('contactsClose').onclick = () => closeContactsModal()
  $('contactsModal').addEventListener('click', e => { if (e.target === $('contactsModal')) closeContactsModal() })
  $('contactAdd').onclick = () => onAddContact()
  $('btnCfgBackup').onclick = () => void onConfigBackup()
  $('btnCfgRestore').onclick = () => void onConfigRestore()
  $('btnCheckUpdates').onclick = () => void onCheckUpdates()
  $('btnNewWallet').onclick = () => {
    if (!confirm('Replace the current wallet with a new one? Back up the current wallet first (its seed phrase / WIF is above) — it will be replaced.')) return
    const { mnemonic, key } = newSeedWallet()
    switchWallet(key, false, mnemonic)
    setStatus('New wallet created — back up your seed phrase!', 'ok')
    localStorage.removeItem(BACKED_UP_KEY); showSeedModal(mnemonic) // new seed → not backed up until confirmed
  }
  $('btnRestore').onclick = () => {
    let k: PrivateKey
    try { k = PrivateKey.fromWif(val('restoreWif')) } catch { setStatus('Invalid WIF.', 'error'); return }
    switchWallet(k, true) // WIF import has no phrase; recover purchases from chain
  }
  $('btnRestoreSeed').onclick = () => {
    let k: PrivateKey
    const phrase = val('restoreSeed').trim().replace(/\s+/g, ' ')
    try { k = keyFromMnemonic(phrase) } catch { setStatus('Invalid seed phrase — check the words and order.', 'error'); return }
    switchWallet(k, true, phrase) // recover purchases from chain + keep the phrase
    markBackedUp() // they typed their own seed → it's already backed up
    ;($('restoreSeed') as HTMLInputElement).value = ''
    setStatus('Wallet restored from seed phrase — recovering from chain…', 'ok')
  }
  $('btnWatchLoad').onclick = () => {
    const pk = val('watchPubKey')
    try { switchToWatch(pk) } catch { setStatus('Enter a valid public key (33- or 65-byte hex) from your offline wallet.', 'error'); return }
    ;($('watchPubKey') as HTMLInputElement).value = ''
    setStatus('Watch-only wallet loaded. Signing actions are disabled here — sign on your offline machine.', 'ok')
  }
  $('btnWatchExit').onclick = () => {
    if (!confirm('Leave watch-only mode? This creates a fresh local wallet on this device (your watched wallet is unaffected — re-load it any time with its public key).')) return
    const { mnemonic, key } = newSeedWallet()
    switchWallet(key, false, mnemonic)
    setStatus('Exited watch-only — a fresh local wallet was created. Back up its seed phrase.', 'ok')
    localStorage.removeItem(BACKED_UP_KEY); showSeedModal(mnemonic)
  }
  // Send BSV (plain payment) + air-gap export
  $('btnSendBsv').onclick = () => void onSendBsv()
  $('btnSendBsvExport').onclick = () => void onSendBsvExport()
  $('sendBsvMax').addEventListener('change', () => {
    const max = ($('sendBsvMax') as HTMLInputElement).checked
    const amt = $('sendBsvAmount') as HTMLInputElement
    amt.disabled = max
    if (max) amt.value = ''
  })
  // Air-gapped signing (Advanced panel)
  $('advAirgap').addEventListener('toggle', () => { if (($('advAirgap') as HTMLDetailsElement).open) populateAirgapEditions() })
  document.querySelectorAll('input[name="agAction"]').forEach(r => r.addEventListener('change', syncAirgapAction))
  $('btnAgExport').onclick = () => void onAirgapExport()
  $('agSignFile').addEventListener('change', () => void onAirgapSignFile())
  $('btnAgSign').onclick = () => void onAirgapSign()
  $('btnAgBroadcast').onclick = () => void onAirgapBroadcast()
  $('btnSeedShow').onclick = () => toggleSeed()
  $('btnSeedCopy').onclick = () => void navigator.clipboard?.writeText((($('seedPhrase') as HTMLTextAreaElement).value))
  $('btnCopyPub').onclick = () => void navigator.clipboard?.writeText(pubKeyHex)
  $('btnCopyAddr').onclick = () => void navigator.clipboard?.writeText(address)
  $('btnQrAddr').onclick = () => showQrModal('Receive address — BSV only', address)
  $('btnQrPub').onclick = () => showQrModal('Public key — scan to share', pubKeyHex)
  $('btnWifShow').onclick = () => {
    const el = $('wif') as HTMLInputElement
    const showing = el.type === 'text'
    el.type = showing ? 'password' : 'text'
    $('btnWifShow').textContent = showing ? '👁 Show' : '🙈 Hide'
  }
  $('btnWifCopy').onclick = () => {
    void navigator.clipboard?.writeText(($('wif') as HTMLInputElement).value)
    const b = $('btnWifCopy'); const prev = b.textContent
    b.textContent = 'Copied ✓'
    setTimeout(() => { b.textContent = prev }, 1200)
  }
  $('viewerClose').onclick = () => closeViewer()
  $('viewer').onclick = (e) => { if (e.target === $('viewer')) closeViewer() } // click backdrop to close

  // Collection / sales view (shareable links).
  $('cvWallet').onclick = () => closeCollectionView()
  $('cvShare').onclick = () => void shareCollectionLink()
  $('cvQr').onclick = () => void (async () => { const l = await currentShareLink(); if (l) showQrModal('Scan to open this sales page', l) })()
  $('cvGet').onclick = () => void onGetCopy()
  $('cvGetTop').onclick = () => {
    // The hero button sits above the fold, but the flow it drives (status, price confirm, fund prompt) lives
    // in the buy card lower down — scroll it into view so the purchase isn't happening off-screen.
    document.querySelector('.cv-buy')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    void onGetCopy()
  }
  // Deliberate re-purchase escape hatch (shown only once you own a copy): a confirm, then the normal buy flow.
  $('cvBuyAnother').onclick = () => {
    if (!currentCollection) return
    if (confirm(`You already own a copy of “${currentCollection.info.name}”.\n\nBuy ANOTHER copy?`)) void onGetCopy()
  }
  $('cvView').onclick = () => { if (currentCollection) void onView(currentCollection.info.tx1Ref, currentCollection.info.name) }
  $('cvNoteSave').onclick = () => void onSaveSellerNote()
  $('cvFundCopy').onclick = () => void navigator.clipboard?.writeText(address)
  $('cvFundDone').onclick = () => void onGetCopy()
  window.addEventListener('hashchange', () => {
    const r = parseHashRoute()
    if (r) void openCollectionView(r.c, r.h, r.g)
    else closeCollectionView()
  })

  // "List your NFT here" deep link (#list=<pubkey>): pre-fill the onboard target and send the publisher to
  // My NFTs to pick a collection to send a copy of.
  const listParam = new URLSearchParams(location.hash.replace(/^#/, '')).get('list')
  if (listParam && /^0[23][0-9a-f]{64}$/.test(listParam.toLowerCase())) {
    pendingListPartner = listParam.toLowerCase()
    activateTab('tokens')
    setStatus(`📤 Listing to ${short(pendingListPartner)} — tap “🤝 Onboard partner” on a collection below to send it a copy for resale.`)
    history.replaceState(null, '', location.pathname + location.search)
  }

  // If the page was opened via a share link, show the storefront over the wallet.
  const route = parseHashRoute()
  if (route) void openCollectionView(route.c, route.h, route.g)

  void refreshBalance()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
