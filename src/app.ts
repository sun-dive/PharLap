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
import { createEdition, replicateEdition, transferEdition, burnEdition, toFundingInputs, scanIncomingEditions, resolveHolderEdition, replicateEditionV2, createGiftVouchers, scanGiftVouchers, sweepGiftVouchers, claimGiftEdition, scanCollectionBuyers, scanMySales, wocScriptHash, type EditionTerms, type EditionUtxo, type BuyerRecord, type MySales, type SalesGroup } from './editionBuilder.ts'
import { buildAirgapRequest, buildAirgapPaymentRequest, signAirgapRequest, encodeAirgapRequest, decodeAirgapRequest, type AirgapAction, type AirgapRequest } from './airgap.ts'
import { sendPayment, gatherPaymentFunding, buildPaymentTx, assertValidAddress } from './payment.ts'
import { parseEditionAny, parseEditionScriptV2, editionSupportsBurn } from './covenant.ts'
import { createTransfer, scanIncoming } from './transfer.ts'
import { sendMessage, scanIncomingMessages, type IncomingMessage } from './messageBuilder.ts'
import { publishSellerNote, resolveSellerNote, readNoteFromTx, type SellerNote } from './sellerNote.ts'
import { publishBroadcast, resolveBroadcasts, type Broadcast } from './broadcast.ts'
import { qrSvg, bsvPaymentUri } from './qr.ts'
import type { Part } from './messageCodec.ts'
import type { StoredToken } from './pharlapStore.ts'
import { verifyTokenLineage } from './verify.ts'
import { parseTemplateScript, parseFileScript, parseStorefrontScript, decodeTokenRules, type TemplateFields } from './tokenCodec.ts'
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
function setStatus(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const el = $('status')
  el.textContent = msg
  el.className = `status ${kind}`
}

// ─── wallet ─────────────────────────────────────────────────────────
const MNEMONIC_KEY = 'p:wallet:mnemonic'
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
function showSeedModal(mnemonic: string): void {
  const words = mnemonic.split(' ')
  const overlay = document.createElement('div'); overlay.className = 'modal'
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:460px">' +
    '<div class="modal-head"><span>🔑 Your new seed phrase</span><button class="secondary seed-close">✕ Close</button></div>' +
    '<p class="muted" style="font-size:13px;margin:0 0 10px">Write these 12 words down, in order, and keep them secret &amp; safe. <b>Anyone with them controls this wallet</b>, and if you lose them with no backup it <b>cannot be recovered</b>.</p>' +
    `<div class="seed-grid">${words.map((w, i) => `<div class="seed-word"><span class="seed-num">${i + 1}</span> ${escapeHtml(w)}</div>`).join('')}</div>` +
    '<div class="row" style="margin-top:12px"><button class="seed-copy">Copy phrase</button><button class="secondary seed-done">I’ve written it down</button></div>' +
    '</div>'
  const close = (): void => overlay.remove()
  overlay.querySelector('.seed-close')?.addEventListener('click', close)
  overlay.querySelector('.seed-done')?.addEventListener('click', close)
  overlay.querySelector('.seed-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(mnemonic))
  document.body.append(overlay)
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

async function onMint(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const name = val('mintName')
  const count = Math.max(1, parseInt(val('mintCount') || '1', 10))
  if (!name) { setStatus('Enter a collection name.', 'error'); return }
  setStatus('Preparing the mint transaction…')
  try {
    const file = await readFile($('mintFile') as HTMLInputElement)
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
    setStatus(`Minted ${result.tokenOutpoints.length} NFT(s). Collection ${short(result.collectionId)} (TX1 ${short(result.tx1Id)}, TX2 ${short(result.tx2Id)}).`, 'ok')
  } catch (e) {
    if ((e as Error).message === SPEND_CANCELLED) { setStatus('Mint cancelled — nothing was spent.'); return }
    setStatus(`Mint failed: ${(e as Error).message}`, 'error')
  }
}

// ─── editions (experimental covenant) ──────────────────────────────
/** Default refundable bond (sats) each edition rides on; the publisher overrides it per collection at mint. */
const EDITION_BOND_SATS = 2100

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

async function onMintEdition(): Promise<void> {
  const k = requireKey(); if (k == null) return
  const name = val('edName')
  if (!name) { setStatus('Enter an edition collection name.', 'error'); return }
  const count = Math.max(1, parseInt(val('edCount') || '1', 10))
  const encrypt = ($('edEncrypt') as HTMLInputElement).checked
  const description = val('edDescription')
  try {
    const file = await readFile($('edFile') as HTMLInputElement)
    const cover = await readFile($('edCover') as HTMLInputElement)
    if (encrypt && !file) { setStatus('Encryption needs a file — attach one or uncheck encrypt.', 'error'); return }
    // v1 fixed-fee editions only. Covenant v2 (percentage/ranged pricing) stays in the codebase
    // (createEditionV2 / replicateEditionV2 / parseEditionScriptV2) but is hidden from the UI until built out.
    const terms = ownTerms()
    setStatus('Preparing the edition mint…')
    const result = await createEdition(provider, k, {
      tokenName: name, terms, mintCount: count, file, encrypt, description, cover,
      confirmSpend: total => confirm(
        `Mint ${count} edition${count > 1 ? 's' : ''} of “${name}”${encrypt ? ' (encrypted)' : ''}${file ? ` (embedding a ${kb(file.bytes.length)} file)` : ''}?\n\n` +
        `This spends ${total.toLocaleString()} sats from your wallet — including a refundable ${(terms.tokenSats ?? EDITION_BOND_SATS).toLocaleString()}-sat bond per edition (reclaimable by burning), plus the network fee.\n\n` +
        `Buyers later pay the publisher ${terms.publisherFeeSats} + holder ${terms.holderFeeSats} sats per copy.\n\nProceed?`),
    })
    for (const e of result.editions) storeEdition(e, result.collectionId, name, terms)
    renderTokens()
    setStatus(`Minted ${result.editions.length} edition(s). Collection ${short(result.collectionId)} (TX2 ${short(result.tx2Id)}).`, 'ok')
  } catch (e) {
    if ((e as Error).message === SPEND_CANCELLED) { setStatus('Edition mint cancelled — nothing was spent.'); return }
    setStatus(`Edition mint failed: ${(e as Error).message}`, 'error')
  }
}

/** The note (promo + bonus) to carry when I sell/transfer an edition I hold: my own published note wins,
 *  else the note that came with this copy (sticky default → hands-off propagation). */
async function noteToPropagate(t: StoredToken): Promise<SellerNote | undefined> {
  try { const p = await resolveSellerNote(provider, pubKeyHex, t.collectionId); if (p && (p.text || p.bonusValue)) return p } catch { /* best-effort */ }
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
    // Edition covenant outputs are a custom script — verify them structurally (lineage walk is future work).
    const ed = parseEditionAny(tx.outputs[outputIndex]?.lockingScript)
    if (ed) {
      const econ = ed.isV2
        ? `publisher ${(ed.terms.pBps / 100).toFixed(2)}% · price ${ed.priceSats} sats`
        : `fees ${ed.terms.publisherFeeSats}/${ed.terms.holderFeeSats} sats`
      setStatus(`✅ Valid ${ed.isV2 ? 'v2 ' : ''}edition covenant — collection ${short(ed.tx1RefHex)}, owner ${short(ed.ownerPubKeyHex)}, ${econ} (structure verified).`, 'ok')
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

async function onView(collectionId: string, collectionName: string): Promise<void> {
  setStatus('Loading the embedded file from the collection…')
  try {
    const tx1 = await provider.getSourceTransaction(collectionId)
    let file: { mimeType: string; fileName: string; fileBytes: number[] } | null = null
    let template: TemplateFields | undefined
    for (const o of tx1.outputs) {
      const f = parseFileScript(o.lockingScript)
      if (f) file = f.fields
      const t = parseTemplateScript(o.lockingScript)
      if (t) template = t.fields
    }
    if (!file) {
      setStatus(`"${collectionName}" has no embedded file.`, 'info')
      return
    }
    const rules = template != null ? decodeTokenRules(template.tokenRules) : null
    const encrypted = rules?.isEncrypted ?? false
    // fileHash binds the ciphertext for encrypted content (privacy) but the ORIGINAL plaintext for public
    // content (provenance) — so the encrypted check runs on the raw stored blob, while the public check runs
    // AFTER the unwind below, against the recovered plaintext.
    const ciphertextOk = encrypted && template?.fileHash === Utils.toHex(Hash.sha256(file.fileBytes))

    // Unwind the stored bytes in the reverse of how they were made: decrypt first, then decompress.
    let bytes = file.fileBytes
    if (encrypted) {
      if (template?.wrappedKey == null || template?.keySalt == null) {
        setStatus('Encrypted collection is missing its wrapped key — cannot decrypt.', 'error'); return
      }
      const K = unwrapContentKey(template.wrappedKey, template.keySalt)
      if (K == null) { setStatus('Could not unwrap the content key.', 'error'); return }
      try { bytes = decryptContent(bytes, K) } catch { setStatus('Decryption failed (wrong key or corrupt ciphertext).', 'error'); return }
    }
    if (rules?.isCompressed) {
      try { bytes = await decompress(bytes) } catch { setStatus('Decompression failed (corrupt data).', 'error'); return }
    }
    // Public: verify the recovered plaintext against the on-chain commitment — this is the "exact replica"
    // proof. Decompression is deterministic, so H(recovered) == fileHash holds regardless of the gzip encoding.
    const verified = encrypted ? ciphertextOk : (template?.fileHash === Utils.toHex(Hash.sha256(bytes)))
    const msg = encrypted
      ? (verified ? '🔓 Decrypted — ciphertext matches the on-chain commitment ✓' : '⚠ Decrypted, but the ciphertext hash does NOT match the collection!')
      : (verified ? '✓ Verified exact replica — SHA-256 of the content matches the on-chain commitment (timestamped on mint)' : '⚠ File loaded, but its hash does NOT match the on-chain commitment!')
    showFile(collectionName, { mimeType: file.mimeType, fileName: file.fileName, fileBytes: bytes }, verified, msg)
    setStatus(msg, verified ? 'ok' : 'error')
  } catch (e) {
    setStatus(`View failed: ${(e as Error).message}`, 'error')
  }
}

function showFile(title: string, file: { mimeType: string; fileName: string; fileBytes: number[] }, verified: boolean, note?: string): void {
  const content = $('viewerContent')
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
  if (file.mimeType.startsWith('image/')) {
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

function closeViewer(): void {
  $('viewer').style.display = 'none'
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
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
  resolvePublisherIdentitiesThen(active, () => renderTokens(true))
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
  resolvePublisherIdentitiesThen(active, () => renderTokens(true))
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

/** The per-copy action buttons (Replicate/Transfer/View/Sales/Verify for editions; Send/Verify/View else). */
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
    view.textContent = 'View'; view.className = 'secondary'
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
    if (iAmPublisher) {
      const buyers = document.createElement('button')
      buyers.textContent = '👥 Buyers'; buyers.className = 'secondary'
      buyers.onclick = () => void onViewBuyers(t)
      if (!ro) {
        const bc = document.createElement('button')
        bc.textContent = '📣 Broadcast'; bc.className = 'secondary'
        bc.onclick = () => void onBroadcast(t)
        const gift = document.createElement('button')
        gift.textContent = '🎁 Gift'; gift.className = 'secondary'
        gift.onclick = () => void onGiftCopies(t)
        const links = document.createElement('button')
        links.textContent = '📥 Gift links'; links.className = 'secondary'
        links.onclick = () => void onViewGiftLinks(t)
        const reclaim = document.createElement('button')
        reclaim.textContent = '♻ Reclaim gifts'; reclaim.className = 'secondary'
        reclaim.onclick = () => void onReclaimGifts(t)
        actions.append(bc, gift, links, reclaim)
      }
      actions.append(buyers)
    }
  } else {
    const view = document.createElement('button')
    view.textContent = 'View'; view.className = 'secondary'
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
    try { for (const k of ['p:nftview', 'p:nftsort']) { const v = localStorage.getItem(k); if (v != null) prefs[k] = v } } catch { prefs = {} }
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
  encrypted: boolean
  replicable: boolean
  hasContentFile: boolean
  publisherPubKeyHex: string | null
  fees: { publisher: number; holder: number } | null
  /** v2 (percentage pricing): publisher basis points + the genesis/reference price (the seller's live price is
   *  resolved at buy time). */
  isV2: boolean
  pBps: number
  v2PriceSats: number
  /** The collection's covenant template bytes (hex) — lets the buy flow reconstruct a holder's edition. */
  covenantHex: string
}

let cvObjectUrl: string | null = null
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

/** Read a `#c=…&h=…` hash route, or null if absent. */
function parseHashRoute(): { c: string; h: string | null; g: string | null } | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const c = params.get('c')
  if (!c) return null
  return { c, h: params.get('h'), g: params.get('g') }
}

/** Fetch TX1 and extract everything the storefront page needs (template + storefront + fees). */
async function loadCollection(tx1Ref: string): Promise<CollectionInfo> {
  const tx1 = await provider.getSourceTransaction(tx1Ref)
  let template: TemplateFields | undefined
  let publisherPubKeyHex: string | null = null
  let storefront: { description: string; coverMimeType?: string; coverBytes?: number[] } | null = null
  let hasContentFile = false
  for (const o of tx1.outputs) {
    const t = parseTemplateScript(o.lockingScript)
    if (t) { template = t.fields; publisherPubKeyHex = t.publisherPubKeyHex }
    const s = parseStorefrontScript(o.lockingScript)
    if (s) storefront = s.fields
    if (parseFileScript(o.lockingScript)) hasContentFile = true
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
  const cover = storefront?.coverBytes
    ? { mimeType: storefront.coverMimeType ?? 'application/octet-stream', bytes: storefront.coverBytes }
    : null
  return {
    tx1Ref, name: template.tokenName, description: storefront?.description ?? '',
    cover, encrypted: rules.isEncrypted, replicable: rules.isReplicable, hasContentFile,
    publisherPubKeyHex, fees, isV2, pBps, v2PriceSats, covenantHex: template.covenantScript,
  }
}

function renderCollectionView(info: CollectionInfo): void {
  $('cvTitle').textContent = info.name || 'Untitled collection'
  const coverHost = $('cvCover')
  coverHost.innerHTML = ''
  if (cvObjectUrl) { URL.revokeObjectURL(cvObjectUrl); cvObjectUrl = null }
  if (info.cover) {
    cvObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(info.cover.bytes)], { type: info.cover.mimeType }))
    const img = document.createElement('img'); img.src = cvObjectUrl; img.className = 'cv-cover-img'
    coverHost.append(img)
  } else {
    coverHost.innerHTML = '<div class="cv-cover-ph">🎴</div>'
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
  if (info.isV2) {
    $('cvPrice').innerHTML = `Get your own copy — <b>${info.v2PriceSats} sats</b> <span class="muted">` +
      `(reseller's price; publisher takes ${(info.pBps / 100).toFixed(2)}% = ${Math.floor(info.v2PriceSats * info.pBps / 10000)} sats, plus a small network fee and a refundable bond you reclaim by burning the token)</span>`
  } else if (info.fees) {
    $('cvPrice').innerHTML = `Get your own copy — <b>${info.fees.publisher + info.fees.holder} sats</b> <span class="muted">(publisher ${info.fees.publisher} + holder ${info.fees.holder}, plus a small network fee and a refundable bond you reclaim by burning the token)</span>`
  } else {
    $('cvPrice').innerHTML = '<span class="muted">This collection is not a replicable edition.</span>'
  }
  ;($('cvGet') as HTMLButtonElement).disabled = info.fees == null && !info.isV2
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
    const info = await loadCollection(tx1Ref)
    currentCollection = { info, holderPubKey }
    renderCollectionView(info)
    if (cvGiftWif) {
      // Reframe the page as a free gift claim.
      ;($('cvGet') as HTMLButtonElement).textContent = '🎁 Get your free copy'
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
  // Drop the hash so a reload returns to the wallet rather than re-opening the storefront.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
}

/** The sales-page link for the current collection, from the current seller's perspective (routed holder
 *  else this wallet). Null if no collection is open. */
function currentShareLink(): string | null {
  if (!currentCollection) return null
  const { info, holderPubKey } = currentCollection
  const h = holderPubKey ?? pubKeyHex
  return `${location.origin}${location.pathname}#c=${info.tx1Ref}&h=${h}`
}

function shareCollectionLink(): void {
  const link = currentShareLink()
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
  if (current && (current.text || current.bonusValue)) {
    cvNote = current
    if (current.text) { noteBox.textContent = `📝 Seller’s note: ${current.text}`; noteBox.style.display = 'block' }
    showBonus(current, holdsIt) // holder sees a claim button; everyone else a teaser
    if (isMine) {
      ;($('cvNoteText') as HTMLTextAreaElement).value = current.text
      if (current.bonusKind && current.bonusValue) {
        ;($('cvBonusKind') as HTMLSelectElement).value = current.bonusKind
        ;($('cvBonusValue') as HTMLInputElement).value = current.bonusValue
      }
    }
  }
}

async function onSaveSellerNote(): Promise<void> {
  const k = requireKey(); if (k == null) return
  if (!currentCollection) return
  const text = ($('cvNoteText') as HTMLTextAreaElement).value.trim()
  const bonusKindRaw = ($('cvBonusKind') as HTMLSelectElement).value
  const bonusValue = ($('cvBonusValue') as HTMLInputElement).value.trim()
  const bonusKind = (bonusKindRaw === 'link' || bonusKindRaw === 'code') ? bonusKindRaw : undefined
  if (!text && !bonusValue) { $('cvNoteStatus').textContent = 'Add a note or a bonus first.'; return }
  if (bonusValue && !bonusKind) { $('cvNoteStatus').textContent = 'Pick a bonus type (link or code).'; return }
  const note: SellerNote = { text, bonusKind, bonusValue: bonusValue || undefined }
  $('cvNoteStatus').textContent = 'Publishing your note…'
  try {
    const txId = await publishSellerNote(provider, k, currentCollection.info.tx1Ref, note)
    cvNote = note
    if (text) { $('cvNote').textContent = `📝 Seller’s note: ${text}`; $('cvNote').style.display = 'block' }
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
  ;($('cvGet') as HTMLButtonElement).disabled = true
  try {
    setCvStatus('Finding the seller’s current edition…')
    let tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex })
    if (!tip) { setCvStatus('This seller has no edition available right now — try another link or ask them to mint one.', 'error'); return }

    // ── Gift claim: a funded voucher (in the link) pays the whole tx; the recipient just owns the copy.
    //    No price prompt, no fund check, works for a brand-new or existing wallet.
    if (cvGiftWif) {
      let giftNote: SellerNote | null = cvNote
      if (!giftNote) { try { giftNote = readNoteFromTx(await provider.getSourceTransaction(tip.txId), info.tx1Ref) } catch { /* best-effort */ } }
      setCvStatus('🎁 Claiming your free copy…')
      const claimed = await claimGiftEdition(provider, k, {
        giftWif: cvGiftWif, editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: giftNote ?? undefined,
      })
      storeEdition({ txId: claimed.replicaOutpoint.txId, outputIndex: claimed.replicaOutpoint.outputIndex, lockHex: claimed.lockHex },
        info.tx1Ref, info.name, tip.terms, giftNote)
      renderTokens()
      showViewButton(info, true)
      setCvStatus('🎁 It’s yours! Your free copy is now in My NFTs.', 'ok')
      cvGiftWif = null // single-use — the voucher is now spent
      return
    }

    // Price = the seller's actual price (v2: their set price split by %; v1: fixed fees).
    const publisherCut = tip.isV2 ? Math.floor((tip.priceSats * info.pBps) / 10000) : tip.terms.publisherFeeSats
    const resellerCut = tip.isV2 ? tip.priceSats - publisherCut : tip.terms.holderFeeSats
    const price = publisherCut + resellerCut
    const ok = confirm(
      `Buy a copy of “${info.name}” for ${price} sats?\n\n` +
      (tip.isV2
        ? `publisher ${(info.pBps / 100).toFixed(2)}% = ${publisherCut} + reseller ${resellerCut} sats, plus a small network fee.\n`
        : `publisher ${publisherCut} + holder ${resellerCut} sats, plus a small network fee.\n`) +
      `This is an instant, on-chain purchase.`,
    )
    if (!ok) { setCvStatus('Purchase cancelled.'); return }

    // Fund check: price + token + replica sats + a little for the miner fee/margin.
    const needed = price + 2 * tip.tokenSats + 1200
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
          ? await replicateEditionV2(provider, k, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: echoNote ?? undefined })
          : await replicateEdition(provider, k, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, terms: tip.terms, note: echoNote ?? undefined })
        break
      } catch (e) {
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
    setCvStatus(`Could not complete the purchase: ${(e as Error).message}`, 'error')
  } finally {
    buying = false
    ;($('cvGet') as HTMLButtonElement).disabled = false
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

/** Publisher: create N pre-funded free-gift links for a collection (each single-use). */
async function onGiftCopies(t: StoredToken): Promise<void> {
  const k = requireKey(); if (k == null) return
  // Per-voucher funding = the recipient's replica BOND + the claim's price/fees (which return to you as
  // holder) + miner fee + a small starter. The bond stays with the recipient (their reclaimable copy), so
  // your real cost ≈ the bond + miner fee per claim.
  let claimCost = 0
  try {
    const ed = parseEditionAny(LockingScript.fromHex(t.lockHex ?? ''))
    if (ed) claimCost = ed.isV2 ? ed.priceSats : (ed.terms.publisherFeeSats + ed.terms.holderFeeSats)
  } catch { /* leave 0 */ }
  const bond = t.tokenSats ?? EDITION_BOND_SATS // unknown → assume the default (over-funding a voucher is harmless; under-funding fails the claim)
  const fundEach = bond + claimCost + 700 /* miner buffer */ + 800 /* recipient starter */
  const countStr = prompt(
    `Create free-gift links for “${t.collectionName ?? 'this collection'}”.\n\n` +
    `How many?  Each is pre-funded with ~${fundEach.toLocaleString()} sats. The price + fees come back to you, but the ` +
    `${bond.toLocaleString()}-sat bond stays with the recipient (their reclaimable copy) — so your real cost ≈ the bond + miner fee per claim.`, '10')
  if (countStr == null) return
  const count = Math.max(1, Math.min(500, parseInt(countStr, 10) || 0))
  const total = count * fundEach
  if (!confirm(`Fund ${count} gift link(s) at ~${fundEach.toLocaleString()} sats each (~${total.toLocaleString()} sats from your wallet). Proceed?`)) return
  setStatus(`Creating ${count} funded gift link(s)…`)
  try {
    // Deterministic keys: scan for the next free index so a new batch doesn't collide with existing vouchers.
    const { nextIndex } = await scanGiftVouchers(provider, k, t.collectionId)
    const { fundingTxId, voucherWifs } = await createGiftVouchers(provider, k, { tx1RefHex: t.collectionId, startIndex: nextIndex, count, fundEachSats: fundEach })
    const links = voucherWifs.map(wif => `${location.origin}${location.pathname}#c=${t.collectionId}&h=${pubKeyHex}&g=${wif}`)
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
    const links = scan.live.map(v => `${location.origin}${location.pathname}#c=${t.collectionId}&h=${pubKeyHex}&g=${v.wif}`)
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

/** Publisher: reclaim UNCLAIMED gift links — sweep their pre-funded sats back to your wallet (invalidating
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
    const cids = [...new Set(res.events.map(e => e.collectionId))]
    await Promise.all(cids.map(async c => { if (!salesNames.has(c)) { try { salesNames.set(c, await resolveCollectionName(c)) } catch { salesNames.set(c, short(c)) } } }))
    paintSales(res, height)
    const keys = res.events.map(e => e.buyerPubKeyHex)
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
  const creatorEv = res.events.filter(e => e.role === 'creator')
  const resellerEv = res.events.filter(e => e.role === 'reseller')
  const earned = res.events.reduce((s, e) => s + e.feeSats, 0)
  const earnedMonth = res.events.filter(e => inMonth(e.height)).reduce((s, e) => s + e.feeSats, 0)
  const salesMonth = creatorEv.filter(e => inMonth(e.height)).length
  const resalesMonth = resellerEv.filter(e => inMonth(e.height)).length
  const uniqueBuyers = new Set(res.events.map(e => e.buyerPubKeyHex.toLowerCase())).size
  const top = res.asCreator[0]
  const noHeight = height === 0
  const monthLbl = noHeight ? 'period n/a' : 'this month'

  statsEl.innerHTML = '<div class="stat-grid">' +
    statTile('Sales (your mints)', String(creatorEv.length), `${salesMonth} ${monthLbl}`) +
    statTile('Earned', `${earned.toLocaleString()} <span class="stat-unit">sat</span>`, `${fmtBsv(earned)} BSV · ${earnedMonth.toLocaleString()} sat ${monthLbl}`) +
    statTile('Your resales', String(resellerEv.length), `${resalesMonth} ${monthLbl}`) +
    statTile('Unique buyers', String(uniqueBuyers), top != null ? `top: ${escapeHtml(salesNames.get(top.collectionId) ?? short(top.collectionId))}` : 'across your mints') +
    '</div>'
  statusEl.textContent = `${res.events.length} sale event${res.events.length === 1 ? '' : 's'}${res.capped ? ` · most recent ${res.scanned} txs` : ''}${noHeight ? ' · couldn’t fetch block height, periods unavailable' : ''}`
  bodyEl.innerHTML = ''
  bodyEl.append(salesSection('📤 As creator — sales of collections you publish', res.asCreator, salesNames, 'No sales of your mints yet.'))
  bodyEl.append(salesSection('🔁 As reseller — your direct resales', res.asReseller, salesNames, 'You haven’t resold a copy yet.'))
}

/** A collapsible section of sales groups (collections), each expanding to its buyer list. */
function salesSection(title: string, groups: SalesGroup[], names: Map<string, string>, empty: string): HTMLElement {
  const sec = document.createElement('div'); sec.className = 'token-section'
  const head = document.createElement('div'); head.className = 'token-section-head'; head.style.cursor = 'default'
  head.innerHTML = `<span class="token-section-label">${title}</span> <span class="count">${groups.length}</span>`
  sec.append(head)
  if (groups.length === 0) {
    const p = document.createElement('p'); p.className = 'muted'; p.style.fontSize = '12px'; p.textContent = empty; sec.append(p); return sec
  }
  for (const g of groups) {
    const name = names.get(g.collectionId) ?? short(g.collectionId)
    const card = document.createElement('div'); card.className = 'sales-group'
    const gh = document.createElement('button'); gh.type = 'button'; gh.className = 'sales-group-head'
    gh.innerHTML = `<span class="chev">▸</span> <span class="sales-group-name">${escapeHtml(name)}</span>` +
      `<span class="sales-group-meta">${g.sales} sale${g.sales === 1 ? '' : 's'} · ${g.buyers.length} buyer${g.buyers.length === 1 ? '' : 's'} · ${g.earnings.toLocaleString()} sat</span>`
    const list = document.createElement('div'); list.className = 'buyers-list'; list.hidden = true
    const msgAll = document.createElement('button'); msgAll.className = 'secondary'; msgAll.style.margin = '6px 0'
    msgAll.textContent = `✉ Message all ${g.buyers.length}`
    msgAll.onclick = () => openCompose(g.buyers.map(b => b.pubKeyHex), { who: `${g.buyers.length} buyers`, product: name, recipientRole: 'buyer' })
    list.append(msgAll)
    for (const b of g.buyers) {
      const row = document.createElement('div'); row.className = 'buyer-row'
      const who = document.createElement('div'); who.className = 'buyer-who'
      who.innerHTML = `${nameChip(b.pubKeyHex)}${b.count > 1 ? ` <span class="muted">×${b.count}</span>` : ''}`
      const msg = document.createElement('button'); msg.className = 'secondary'; msg.textContent = '✉ Message'
      msg.onclick = () => composeTo(b.pubKeyHex, 'this buyer', { product: name, recipientRole: 'buyer' })
      row.append(who, msg); list.append(row)
    }
    gh.onclick = () => { list.hidden = !list.hidden; gh.querySelector('.chev')!.textContent = list.hidden ? '▸' : '▾' }
    card.append(gh, list); sec.append(card)
  }
  return sec
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
  $('btnMint').onclick = () => void onMint()
  $('btnMintEdition').onclick = () => void onMintEdition()
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
    showSeedModal(mnemonic) // force the backup moment
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
    showSeedModal(mnemonic)
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
  $('cvShare').onclick = () => shareCollectionLink()
  $('cvQr').onclick = () => { const l = currentShareLink(); if (l) showQrModal('Scan to open this sales page', l) }
  $('cvGet').onclick = () => void onGetCopy()
  $('cvView').onclick = () => { if (currentCollection) void onView(currentCollection.info.tx1Ref, currentCollection.info.name) }
  $('cvNoteSave').onclick = () => void onSaveSellerNote()
  $('cvFundCopy').onclick = () => void navigator.clipboard?.writeText(address)
  $('cvFundDone').onclick = () => void onGetCopy()
  window.addEventListener('hashchange', () => {
    const r = parseHashRoute()
    if (r) void openCollectionView(r.c, r.h, r.g)
    else closeCollectionView()
  })

  // If the page was opened via a share link, show the storefront over the wallet.
  const route = parseHashRoute()
  if (route) void openCollectionView(route.c, route.h, route.g)

  void refreshBalance()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
