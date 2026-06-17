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
import { PrivateKey, Utils, Hash, LockingScript } from '@bsv/sdk'
import { WalletProvider } from './walletProvider.ts'
import { PharLapStore } from './pharlapStore.ts'
import { createCollection, getSafeUtxos, SPEND_CANCELLED } from './collectionBuilder.ts'
import { createEdition, replicateEdition, transferEdition, burnEdition, scanIncomingEditions, resolveHolderEdition, replicateEditionV2, createGiftVouchers, scanGiftVouchers, claimGiftEdition, type EditionTerms } from './editionBuilder.ts'
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
import { unwrapContentKey, decryptContent } from './contentCrypto.ts'
import { decompress } from './compress.ts'

const WIF_KEY = 'p:wallet:wif'

let key: PrivateKey
let pubKeyHex: string
let address: string
let provider: WalletProvider
let store: PharLapStore
let nftView: 'list' | 'grid' = 'list' // My-NFTs view mode (persisted in localStorage)
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
function loadKey(): PrivateKey {
  const wif = localStorage.getItem(WIF_KEY)
  if (wif) {
    try { return PrivateKey.fromWif(wif) } catch { /* fall through to new */ }
  }
  const k = PrivateKey.fromRandom()
  localStorage.setItem(WIF_KEY, k.toWif())
  return k
}

function useKey(k: PrivateKey): void {
  key = k
  pubKeyHex = k.toPublicKey().toString()
  address = k.toAddress()
  provider = new WalletProvider(address)
  renderWallet()
}

/**
 * Switch the active wallet. The local token store is a CACHE belonging to the previous wallet, so clear it
 * and (on a WIF restore) rebuild this wallet's holdings from chain — the WIF + chain are the source of
 * truth, so purchases recover on any device. A fresh random wallet has nothing to recover.
 */
function switchWallet(k: PrivateKey, recover: boolean): void {
  localStorage.setItem(WIF_KEY, k.toWif())
  store.clear()
  useKey(k)
  renderTokens()
  void refreshBalance()
  if (recover) {
    setStatus('Wallet restored — recovering your purchases from chain…')
    void onCheckIncoming()
  }
}

function renderWallet(): void {
  $('address').textContent = address
  $('pubkey').textContent = pubKeyHex
  const mine = document.getElementById('myIdenticon')
  if (mine) mine.innerHTML = avatarHtml(pubKeyHex, 22) // your own avatar (or identicon)
  ;($('wif') as HTMLInputElement).value = key.toWif()
  hideWif() // re-mask on every wallet (re)load so a switched-in key is never left exposed
}

/** Mask the WIF input and reset the toggle to "Show". */
function hideWif(): void {
  ;($('wif') as HTMLInputElement).type = 'password'
  $('btnWifShow').textContent = '👁 Show'
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
  const name = val('mintName')
  const count = Math.max(1, parseInt(val('mintCount') || '1', 10))
  if (!name) { setStatus('Enter a collection name.', 'error'); return }
  setStatus('Preparing the mint transaction…')
  try {
    const file = await readFile($('mintFile') as HTMLInputElement)
    const result = await createCollection(provider, key, {
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

function ownTerms(): EditionTerms {
  return {
    publisherPubKeyHash: Hash.hash160(key.toPublicKey().encode(true) as number[]),
    publisherFeeSats: Math.max(0, parseInt(val('edPublisherFee') || '0', 10)),
    holderFeeSats: Math.max(0, parseInt(val('edHolderFee') || '0', 10)),
    tokenSats: chosenBond(),
  }
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
    const result = await createEdition(provider, key, {
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

async function onReplicate(t: StoredToken): Promise<void> {
  if (!t.lockHex) { setStatus('Missing edition script; cannot replicate.', 'error'); return }
  const name = t.collectionName ?? 'this edition'
  // A bonded edition's replica carries the same refundable bond — the dominant non-fee cost — so call it out.
  const bondNote = editionSupportsBurn(Utils.toArray(t.lockHex, 'hex'))
    ? 'a refundable bond for your copy (reclaim it by burning) + ' : ''
  setStatus('Preparing the replication…')
  try {
    // v2 (percentage pricing) editions go through the computed-split replicate.
    if (parseEditionScriptV2(LockingScript.fromHex(t.lockHex)) != null) {
      const r = await replicateEditionV2(provider, key, {
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
    const r = await replicateEdition(provider, key, {
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
    if ((e as Error).message === SPEND_CANCELLED) { setStatus('Replication cancelled — nothing was spent.'); return }
    setStatus(`Replicate failed: ${(e as Error).message}`, 'error')
  }
}

async function onTransferEdition(t: StoredToken): Promise<void> {
  const recipient = val('sendPubKey')
  if (recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex) above.", 'error'); return
  }
  if (!t.lockHex) { setStatus('Missing edition script; cannot transfer.', 'error'); return }
  setStatus('Transferring edition (owner-signed, re-creating covenant)…')
  try {
    const note = await noteToPropagate(t)
    const r = await transferEdition(provider, key, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex,
      newOwnerPubKey: Utils.toArray(recipient, 'hex'), note,
    })
    store.markSent(t.txId, t.outputIndex)
    renderTokens()
    setStatus(`✅ Transferred. Tx ${short(r.txId)} — covenant re-created for the new owner.`, 'ok')
  } catch (e) {
    setStatus(`Transfer failed: ${(e as Error).message}`, 'error')
  }
}

/** Burn an owned edition: owner-signed spend that destroys the token and reclaims its bond to your wallet. */
async function onBurn(t: StoredToken): Promise<void> {
  if (!t.lockHex) { setStatus('Missing edition script; cannot burn.', 'error'); return }
  if (!confirm(
    `Burn your edition of “${t.collectionName ?? 'this collection'}” and reclaim its ~${(t.tokenSats ?? EDITION_BOND_SATS).toLocaleString()}-sat bond ` +
    `(minus a small network fee) to your wallet?\n\n⚠ This DESTROYS the token permanently — it cannot be undone. Proceed?`)) return
  setStatus('Burning edition (reclaiming the bond)…')
  try {
    const r = await burnEdition(provider, key, { editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex })
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
      setStatus('Burn failed: the network can’t spend this edition’s UTXO — it’s either not confirmed/propagated yet, or it has already been spent (moved or burned). If you just minted it, wait a few minutes and retry; otherwise tap Refresh to resync your holdings.', 'error')
    } else if (/raw TX fetch failed/i.test(msg)) {
      setStatus('Burn failed: this edition’s transaction isn’t on-chain yet. Wait for it to confirm (usually a few minutes), then try again.', 'error')
    } else {
      setStatus(`Burn failed: ${msg}`, 'error')
    }
  }
}

// ─── send ───────────────────────────────────────────────────────────
async function onSend(txId: string, outputIndex: number): Promise<void> {
  const recipient = val('sendPubKey')
  if (recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex).", 'error'); return
  }
  setStatus('Sending NFT…')
  try {
    const result = await createTransfer(provider, key, { tokenTxId: txId, tokenOutputIndex: outputIndex, recipientPubKeyHex: recipient })
    store.markSent(txId, outputIndex)
    renderTokens()
    setStatus(`Sent. Transfer tx ${short(result.txId)} (recipient notified at output ${result.notifyVout}).`, 'ok')
  } catch (e) {
    setStatus(`Send failed: ${(e as Error).message}`, 'error')
  }
}

// ─── messaging ──────────────────────────────────────────────────────
async function onSendMessage(): Promise<void> {
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
    const r = await sendMessage(provider, key, { toPubKeyHex: to, parts, encrypt, senderAlias: getMyAlias() })
    ;($('msgText') as HTMLTextAreaElement).value = ''
    setStatus(`Message sent. Tx ${short(r.txId)}.`, 'ok')
  } catch (e) {
    setStatus(`Send message failed: ${(e as Error).message}`, 'error')
  }
}

/** Publish your profile (alias + optional avatar) on-chain so others resolve your @name + face by pubkey. */
async function onPublishProfile(): Promise<void> {
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
    const txId = await publishProfile(provider, key, { alias: alias || undefined, avatar })
    if (avatar != null) { setAvatar(myPubKeyLc(), bytesToDataUrl(avatar.mimeType, avatar.bytes)); renderWallet() }
    ;($('profileAvatar') as HTMLInputElement).value = ''
    setStatus(`✅ Profile published. Tx ${short(txId)} — others now resolve your @name + avatar by your key.`, 'ok')
  } catch (e) {
    setStatus(`Publish profile failed: ${(e as Error).message}`, 'error')
  }
}

async function onCheckMessages(): Promise<void> {
  setStatus('Checking for messages…')
  try {
    const msgs = await scanIncomingMessages(provider, key)
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
  const myHash = Utils.toHex(Hash.hash160(key.toPublicKey().encode(true) as number[]))
  // Group identical holdings (same collection = interchangeable copies/editions), preserving sort order
  // by first appearance. A single copy renders as a normal card; multiples collapse into one group card.
  const groups = new Map<string, StoredToken[]>()
  for (const t of active) {
    const g = groups.get(t.collectionId)
    if (g != null) g.push(t); else groups.set(t.collectionId, [t])
  }
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
  head.onclick = () => {
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
  const verify = document.createElement('button')
  verify.textContent = 'Verify'; verify.className = 'secondary'
  verify.onclick = () => void onVerify(t.txId, t.outputIndex)
  const actions = document.createElement('div')
  actions.className = 'actions'
  if (isEdition) {
    const replicate = document.createElement('button')
    replicate.textContent = 'Replicate'
    replicate.onclick = () => void onReplicate(t)
    const xfer = document.createElement('button')
    xfer.textContent = 'Transfer'; xfer.className = 'secondary'
    xfer.onclick = () => void onTransferEdition(t)
    const view = document.createElement('button')
    view.textContent = 'View'; view.className = 'secondary'
    view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Edition')
    const sales = document.createElement('button')
    sales.textContent = 'Sales page'; sales.className = 'secondary'
    sales.onclick = () => onOpenSalesPage(t)
    actions.append(replicate, xfer, view, sales, verify)
    // 🔥 Burn — only for burn-capable (bonded) editions; reclaims the bond and destroys the token.
    if (t.lockHex != null && editionSupportsBurn(Utils.toArray(t.lockHex, 'hex'))) {
      const burn = document.createElement('button')
      burn.textContent = '🔥 Burn'; burn.className = 'secondary'
      burn.onclick = () => void onBurn(t)
      actions.append(burn)
    }
    if (iAmPublisher) {
      const bc = document.createElement('button')
      bc.textContent = '📣 Broadcast'; bc.className = 'secondary'
      bc.onclick = () => void onBroadcast(t)
      const gift = document.createElement('button')
      gift.textContent = '🎁 Gift'; gift.className = 'secondary'
      gift.onclick = () => void onGiftCopies(t)
      const links = document.createElement('button')
      links.textContent = '📥 Gift links'; links.className = 'secondary'
      links.onclick = () => void onViewGiftLinks(t)
      actions.append(bc, gift, links)
    }
  } else {
    const send = document.createElement('button')
    send.textContent = 'Send'
    send.onclick = () => void onSend(t.txId, t.outputIndex)
    const view = document.createElement('button')
    view.textContent = 'View'; view.className = 'secondary'
    view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Collection')
    actions.append(send, verify, view)
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
let seenAliases: Record<string, string> = {} // pubkeyHex(lc) → observed self-asserted alias (unverified)
let pinned: Record<string, 1> = {} // pubkeyHex(lc) → 1 if you set a CUSTOM label (don't auto-follow renames)

function persist(k: string, v: object): void { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota */ } }

function loadAliases(): void {
  try { contacts = JSON.parse(localStorage.getItem('p:contacts') ?? '{}') } catch { contacts = {} }
  try { seenAliases = JSON.parse(localStorage.getItem('p:aliases') ?? '{}') } catch { seenAliases = {} }
  try { pinned = JSON.parse(localStorage.getItem('p:pinned') ?? '{}') } catch { pinned = {} }
  try { avatars = JSON.parse(localStorage.getItem('p:avatars') ?? '{}') } catch { avatars = {} }
}
function getMyAlias(): string { try { return (localStorage.getItem('p:myalias') ?? '').trim() } catch { return '' } }
function setMyAlias(a: string): void { try { localStorage.setItem('p:myalias', a) } catch { /* fine */ } }

/** Record a self-asserted alias from a key. A saved contact you ACCEPTED (not pinned) follows the key's
 *  renames — it's provably the same key; a contact you gave a CUSTOM label (pinned) stays put. Unsaved keys
 *  just track their latest self-claim (shown as unverified). */
function rememberAlias(pubKeyHex: string, alias: string): void {
  if (alias === '') return
  const k = pubKeyHex.toLowerCase()
  if (contacts[k] != null) {
    if (!pinned[k] && contacts[k] !== alias) { contacts[k] = alias; persist('p:contacts', contacts) } // follow rename
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
}

function removeContact(pubKeyHex: string): void {
  const k = pubKeyHex.toLowerCase()
  delete contacts[k]; delete pinned[k]
  persist('p:contacts', contacts); persist('p:pinned', pinned)
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

// ─── address book ───────────────────────────────────────────────────
function openContactsModal(): void {
  renderContacts()
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
      `(reseller's price; publisher takes ${(info.pBps / 100).toFixed(2)}% = ${Math.floor(info.v2PriceSats * info.pBps / 10000)} sats, plus a small network fee)</span>`
  } else if (info.fees) {
    $('cvPrice').innerHTML = `Get your own copy — <b>${info.fees.publisher + info.fees.holder} sats</b> <span class="muted">(publisher ${info.fees.publisher} + holder ${info.fees.holder}, plus a small network fee)</span>`
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
    const txId = await publishSellerNote(provider, key, currentCollection.info.tx1Ref, note)
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
      const claimed = await claimGiftEdition(provider, key, {
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
          ? await replicateEditionV2(provider, key, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, note: echoNote ?? undefined })
          : await replicateEdition(provider, key, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex, terms: tip.terms, note: echoNote ?? undefined })
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
  const text = prompt(`Announce to all holders of “${t.collectionName ?? 'this collection'}”.\n\nPublic, one transaction, reaches every current holder. Message:`)
  if (text == null) return
  const trimmed = text.trim()
  if (!trimmed) { setStatus('Announcement was empty.', 'error'); return }
  setStatus('Publishing announcement to holders…')
  try {
    const txId = await publishBroadcast(provider, key, t.collectionId, trimmed, getMyAlias())
    latestBroadcast.set(t.collectionId, { text: trimmed, txId, height: 0 })
    renderTokens()
    setStatus(`📣 Announcement published (${short(txId)}). Holders see it when they check Updates.`, 'ok')
  } catch (e) {
    setStatus(`Broadcast failed: ${(e as Error).message}`, 'error')
  }
}

/** Publisher: create N pre-funded free-gift links for a collection (each single-use). */
async function onGiftCopies(t: StoredToken): Promise<void> {
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
    const { nextIndex } = await scanGiftVouchers(provider, key, t.collectionId)
    const { fundingTxId, voucherWifs } = await createGiftVouchers(provider, key, { tx1RefHex: t.collectionId, startIndex: nextIndex, count, fundEachSats: fundEach })
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
  setStatus('Recovering your gift links from chain…')
  try {
    const scan = await scanGiftVouchers(provider, key, t.collectionId)
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
function initTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('.tab'))
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.tabpanel'))
  const activate = (name: string) => {
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === name))
    panels.forEach(p => p.classList.toggle('is-active', p.id === `tab-${name}`))
    try { localStorage.setItem('p:activeTab', name) } catch { /* private mode — ignore */ }
  }
  tabs.forEach(t => { t.onclick = () => activate(t.dataset.tab!) })
  // Home-page cards (and any other in-app shortcut) jump to a tab via data-goto.
  document.querySelectorAll<HTMLElement>('[data-goto]').forEach(el => {
    el.onclick = () => activate(el.dataset.goto!)
  })
  let saved: string | null = null
  try { saved = localStorage.getItem('p:activeTab') } catch { /* ignore */ }
  if (saved && tabs.some(t => t.dataset.tab === saved)) activate(saved)
}

function init(): void {
  store = new PharLapStore()
  loadAliases() // before useKey(): renderWallet() draws your own avatar, which reads the loaded p:avatars cache
  useKey(loadKey())
  try { if (localStorage.getItem('p:nftview') === 'grid') nftView = 'grid' } catch { /* default list */ }
  updateViewToggle()
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
  $('btnIncoming').onclick = () => void onCheckIncoming()
  $('btnSendMessage').onclick = () => void onSendMessage()
  $('btnCheckMessages').onclick = () => void onCheckMessages()
  $('msgTo').addEventListener('input', updateMsgToName)
  $('btnContacts').onclick = () => openContactsModal()
  $('btnPublishProfile').onclick = () => void onPublishProfile()
  $('contactsClose').onclick = () => closeContactsModal()
  $('contactsModal').addEventListener('click', e => { if (e.target === $('contactsModal')) closeContactsModal() })
  $('contactAdd').onclick = () => onAddContact()
  $('btnCheckUpdates').onclick = () => void onCheckUpdates()
  $('btnNewWallet').onclick = () => {
    if (!confirm('Replace the current wallet with a new random key? Your current key is in the WIF box — back it up first.')) return
    switchWallet(PrivateKey.fromRandom(), false)
    setStatus('New wallet created.', 'ok')
  }
  $('btnRestore').onclick = () => {
    let k: PrivateKey
    try { k = PrivateKey.fromWif(val('restoreWif')) } catch { setStatus('Invalid WIF.', 'error'); return }
    switchWallet(k, true) // recover this wallet's purchases from chain
  }
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
