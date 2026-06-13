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
import { createCollection, getSafeUtxos } from './collectionBuilder.ts'
import { createEdition, replicateEdition, transferEdition, broadcastV2Probe, scanIncomingEditions, resolveHolderEdition, createEditionV2, replicateEditionV2, type EditionTerms } from './editionBuilder.ts'
import { parseEditionAny, parseEditionScriptV2 } from './covenant.ts'
import { createTransfer, scanIncoming } from './transfer.ts'
import { sendMessage, scanIncomingMessages, type IncomingMessage } from './messageBuilder.ts'
import { publishSellerNote, resolveSellerNote, readNoteFromTx, type SellerNote } from './sellerNote.ts'
import type { Part } from './messageCodec.ts'
import type { StoredToken } from './pharlapStore.ts'
import { verifyTokenLineage } from './verify.ts'
import { parseTemplateScript, parseFileScript, parseStorefrontScript, decodeTokenRules, type TemplateFields } from './tokenCodec.ts'
import { unwrapContentKey, decryptContent } from './contentCrypto.ts'

const WIF_KEY = 'p:wallet:wif'

let key: PrivateKey
let pubKeyHex: string
let address: string
let provider: WalletProvider
let store: PharLapStore

// ─── small DOM helpers ──────────────────────────────────────────────
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}
const val = (id: string): string => ($(id) as HTMLInputElement).value.trim()
const short = (s: string, n = 10): string => (s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-n)}` : s)
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
  ;($('wif') as HTMLInputElement).value = key.toWif()
}

async function refreshBalance(): Promise<void> {
  setStatus('Fetching balance…')
  try {
    const safe = await getSafeUtxos(provider)
    const spendable = safe.reduce((s, u) => s + u.satoshis, 0)
    $('balance').textContent = `${spendable} sat spendable (${safe.length} funding UTXO${safe.length === 1 ? '' : 's'})`
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
  setStatus('Minting collection (TX1 template + TX2 genesis)…')
  try {
    const file = await readFile($('mintFile') as HTMLInputElement)
    const result = await createCollection(provider, key, { tokenName: name, supply: count, mintCount: count, file })
    for (const op of result.tokenOutpoints) {
      store.add({ txId: op.txId, outputIndex: op.outputIndex, collectionId: result.collectionId, stateData: '', collectionName: name })
    }
    renderTokens()
    setStatus(`Minted ${result.tokenOutpoints.length} token(s). Collection ${short(result.collectionId)} (TX1 ${short(result.tx1Id)}, TX2 ${short(result.tx2Id)}).`, 'ok')
  } catch (e) {
    setStatus(`Mint failed: ${(e as Error).message}`, 'error')
  }
}

// ─── editions (experimental covenant) ──────────────────────────────
function ownTerms(): EditionTerms {
  return {
    creatorPubKeyHash: Hash.hash160(key.toPublicKey().encode(true) as number[]),
    creatorFeeSats: Math.max(0, parseInt(val('edCreatorFee') || '0', 10)),
    holderFeeSats: Math.max(0, parseInt(val('edHolderFee') || '0', 10)),
    tokenSats: 1,
  }
}

function termsFromToken(t: StoredToken): EditionTerms {
  return {
    creatorPubKeyHash: Utils.toArray(t.creatorPubKeyHashHex ?? '', 'hex'),
    creatorFeeSats: t.creatorFeeSats ?? 0,
    holderFeeSats: t.holderFeeSats ?? 0,
    tokenSats: 1,
  }
}

function storeEdition(o: { txId: string; outputIndex: number; lockHex: string }, collectionId: string, name: string, terms: EditionTerms, note?: SellerNote | null): void {
  store.add({
    txId: o.txId, outputIndex: o.outputIndex, collectionId, stateData: '', collectionName: name,
    kind: 'edition', lockHex: o.lockHex, creatorPubKeyHashHex: Utils.toHex(terms.creatorPubKeyHash),
    creatorFeeSats: terms.creatorFeeSats, holderFeeSats: terms.holderFeeSats,
    ...(note?.text ? { sellerNote: note.text } : {}),
    ...(note?.bonusValue ? { bonusKind: note.bonusKind, bonusValue: note.bonusValue } : {}),
  })
}

async function onV2Probe(): Promise<void> {
  if (!confirm('Broadcast a tiny version-2 (Chronicle) self-send to confirm the network accepts v2 txs? Costs only the miner fee.')) return
  setStatus('Broadcasting v2 probe…')
  try {
    const txId = await broadcastV2Probe(provider, key)
    setStatus(`✅ v2 tx accepted by broadcast: ${short(txId)}. Confirm it on WhatsOnChain.`, 'ok')
  } catch (e) {
    setStatus(`v2 probe rejected: ${(e as Error).message}`, 'error')
  }
}

/** Toggle the mint form between fixed-fee (v1) and percentage (v2) inputs based on the pricing-mode select. */
function syncMintMode(): void {
  const pct = ($('edMode') as HTMLSelectElement).value === 'percentage'
  const show = (id: string, on: boolean) => { ($(id) as HTMLElement).style.display = on ? '' : 'none' }
  show('edFixedFees', !pct); show('edFixedHelp', !pct)
  show('edPctFees', pct); show('edPctHelp', pct); show('btnV2SelfTest', pct)
}

async function onMintEdition(): Promise<void> {
  const name = val('edName')
  if (!name) { setStatus('Enter an edition collection name.', 'error'); return }
  const mode = ($('edMode') as HTMLSelectElement).value
  const count = Math.max(1, parseInt(val('edCount') || '1', 10))
  const encrypt = ($('edEncrypt') as HTMLInputElement).checked
  const description = val('edDescription')
  try {
    const file = await readFile($('edFile') as HTMLInputElement)
    const cover = await readFile($('edCover') as HTMLInputElement)
    if (encrypt && !file) { setStatus('Encryption needs a file — attach one or uncheck encrypt.', 'error'); return }
    if (mode === 'percentage') {
      const cBps = Math.max(0, Math.min(10000, parseInt(val('edBps') || '250', 10)))
      const price = Math.max(1, parseInt(val('edPrice') || '5000', 10))
      const creatorPubKeyHash = Hash.hash160(key.toPublicKey().encode(true) as number[])
      setStatus(`Minting ${encrypt ? 'encrypted ' : ''}percentage-pricing collection (creator ${(cBps / 100).toFixed(2)}%, reseller price ${price} sat)…`)
      const minted = await createEditionV2(provider, key, { tokenName: name, terms: { creatorPubKeyHash, cBps }, initialPriceSats: price, mintCount: count, file, encrypt, description, cover })
      for (const e of minted.editions) storeEdition(e, minted.collectionId, name, { creatorPubKeyHash, creatorFeeSats: 0, holderFeeSats: 0 })
      renderTokens()
      setStatus(`Minted ${minted.editions.length} edition(s). Collection ${short(minted.collectionId)} (TX2 ${short(minted.tx2Id)}). Open a Sales page to share a buy link.`, 'ok')
      return
    }
    const terms = ownTerms()
    setStatus(`Minting ${encrypt ? 'encrypted ' : ''}edition collection (TX1 template + TX2 covenant editions)…`)
    const result = await createEdition(provider, key, { tokenName: name, terms, mintCount: count, file, encrypt, description, cover })
    for (const e of result.editions) storeEdition(e, result.collectionId, name, terms)
    renderTokens()
    setStatus(`Minted ${result.editions.length} edition(s). Collection ${short(result.collectionId)} (TX2 ${short(result.tx2Id)}).`, 'ok')
  } catch (e) {
    setStatus(`Edition mint failed: ${(e as Error).message}`, 'error')
  }
}

/** Covenant v2 mainnet self-test: mint a percentage-pricing edition, then permissionlessly replicate it.
 *  A dev-only tool surfaced when the mint form is in percentage mode; reads the same bps/price inputs. */
async function onV2SelfTest(): Promise<void> {
  const cBps = Math.max(0, Math.min(10000, parseInt(val('edBps') || '250', 10)))
  const price = Math.max(1, parseInt(val('edPrice') || '50000', 10))
  if (!confirm(`MAINNET v2 self-test — spends real BSV.\n\nMint a percentage-pricing edition (creator ${(cBps / 100).toFixed(2)}%, price ${price} sat) then permissionlessly replicate it (you are creator = holder = buyer). Proceed?`)) return
  setStatus('v2 self-test: minting (TX1 template + TX2 v2 genesis)…')
  try {
    const creatorPubKeyHash = key.toPublicKey().toHash() as number[]
    const minted = await createEditionV2(provider, key, {
      tokenName: 'v2 mainnet test', terms: { creatorPubKeyHash, cBps }, initialPriceSats: price,
    })
    const ed = minted.editions[0]
    setStatus(`Minted v2 collection ${short(minted.tx1Id)} · edition ${short(ed.txId)}:${ed.outputIndex}. Replicating (computed split)…`)
    const r = await replicateEditionV2(provider, key, {
      editionTxId: ed.txId, editionOutputIndex: ed.outputIndex, editionLockHex: ed.lockHex, editionSourceTx: minted.tx2,
    })
    setStatus(
      `✅ v2 MAINNET broadcast! TX1 ${short(minted.tx1Id)} · TX2 ${short(minted.tx2Id)} · replicate ${short(r.txId)} ` +
      `— creator ${r.creatorCut} + reseller ${r.resellerCut} sat. Check these txids on WhatsOnChain (expect them mined).`,
      'ok',
    )
    console.log('v2 self-test txids:', { tx1: minted.tx1Id, tx2: minted.tx2Id, replicate: r.txId, creatorCut: r.creatorCut, resellerCut: r.resellerCut })
  } catch (e) {
    setStatus(`v2 self-test failed: ${(e as Error).message}`, 'error')
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
  setStatus('Replicating edition (permissionless mint)…')
  try {
    // v2 (percentage pricing) editions go through the computed-split replicate.
    if (parseEditionScriptV2(LockingScript.fromHex(t.lockHex)) != null) {
      const r = await replicateEditionV2(provider, key, { editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex })
      store.markSent(t.txId, t.outputIndex) // original spent; token returned to holder at out[0] (new outpoint)
      storeEdition({ txId: r.txId, outputIndex: 0, lockHex: t.lockHex }, t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
      storeEdition({ txId: r.replicaOutpoint.txId, outputIndex: r.replicaOutpoint.outputIndex, lockHex: r.lockHex }, t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
      renderTokens()
      setStatus(`✅ v2 replicated. Tx ${short(r.txId)} — creator ${r.creatorCut} + reseller ${r.resellerCut} sat.`, 'ok')
      return
    }
    const note = await noteToPropagate(t)
    const r = await replicateEdition(provider, key, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex, terms: termsFromToken(t),
      note,
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
    setStatus(`✅ Replicated. Tx ${short(r.txId)} — token returned to holder, replica minted, fees paid.`, 'ok')
  } catch (e) {
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

// ─── send ───────────────────────────────────────────────────────────
async function onSend(txId: string, outputIndex: number): Promise<void> {
  const recipient = val('sendPubKey')
  if (recipient.length !== 66 && recipient.length !== 130) {
    setStatus("Enter the recipient's public key (33- or 65-byte hex).", 'error'); return
  }
  setStatus('Sending token…')
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
    const r = await sendMessage(provider, key, { toPubKeyHex: to, parts, encrypt })
    ;($('msgText') as HTMLTextAreaElement).value = ''
    setStatus(`Message sent. Tx ${short(r.txId)}.`, 'ok')
  } catch (e) {
    setStatus(`Send message failed: ${(e as Error).message}`, 'error')
  }
}

async function onCheckMessages(): Promise<void> {
  setStatus('Checking for messages…')
  try {
    const msgs = await scanIncomingMessages(provider, key)
    renderInbox(msgs)
    setStatus(`Inbox: ${msgs.length} message(s).`, 'ok')
  } catch (e) {
    setStatus(`Check messages failed: ${(e as Error).message}`, 'error')
  }
}

function renderInbox(msgs: IncomingMessage[]): void {
  const host = $('inbox')
  if (msgs.length === 0) { host.innerHTML = '<p class="muted">No messages found.</p>'; return }
  host.innerHTML = ''
  for (const m of msgs) {
    const card = document.createElement('div')
    card.className = 'token'
    const textPart = m.parts.find(p => p.kind === 'text')
    const hasKey = m.parts.some(p => p.kind === 'key')
    const filePart = m.parts.find(p => p.kind === 'file')
    card.innerHTML = `
      <div class="mono">from ${short(m.senderPubKeyHex)} ${m.encrypted ? '🔒 encrypted' : '🌐 public'}</div>
      ${textPart && textPart.kind === 'text' ? `<div class="state">${escapeHtml(textPart.text)}</div>` : ''}
      ${hasKey ? '<div class="muted" style="font-size:12px">🔑 carries a content key</div>' : ''}
    `
    if (filePart && filePart.kind === 'file') {
      const btn = document.createElement('button')
      btn.textContent = `View ${filePart.fileName}`
      btn.className = 'secondary'
      btn.onclick = () => showFile('Message attachment', { mimeType: filePart.mimeType, fileName: filePart.fileName, fileBytes: filePart.bytes }, true)
      const actions = document.createElement('div')
      actions.className = 'actions'
      actions.append(btn)
      card.append(actions)
    }
    host.append(card)
  }
}

// ─── check incoming ─────────────────────────────────────────────────
// A received edition's token doesn't carry the collection title (that lives in TX1's template), so the
// incoming scan defaults it to "Edition". Resolve the real name from TX1 (cached per collection).
const nameCache = new Map<string, string>()
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
  setStatus('Scanning for incoming tokens and editions…')
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
        kind: 'edition', lockHex: e.lockHex, creatorPubKeyHashHex: Utils.toHex(e.terms.creatorPubKeyHash),
        creatorFeeSats: e.terms.creatorFeeSats, holderFeeSats: e.terms.holderFeeSats,
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
    setStatus(`Scan complete: ${added} token(s) + ${edAdded} edition(s) new.${errors.length ? ' (' + errors.join('; ') + ')' : ''}`, 'ok')
  }
}

// ─── verify ─────────────────────────────────────────────────────────
async function onVerify(txId: string, outputIndex: number): Promise<void> {
  setStatus('Verifying token lineage…')
  try {
    const tx = await provider.getSourceTransaction(txId)
    // Edition covenant outputs are a custom script — verify them structurally (lineage walk is future work).
    const ed = parseEditionAny(tx.outputs[outputIndex]?.lockingScript)
    if (ed) {
      const econ = ed.isV2
        ? `creator ${(ed.terms.cBps / 100).toFixed(2)}% · price ${ed.priceSats} sat`
        : `fees ${ed.terms.creatorFeeSats}/${ed.terms.holderFeeSats} sat`
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
    // The stored bytes (cipher- or plain-text) are what fileHash binds.
    const verified = template?.fileHash === Utils.toHex(Hash.sha256(file.fileBytes))
    const encrypted = template != null && decodeTokenRules(template.tokenRules).isEncrypted

    if (encrypted) {
      if (template?.wrappedKey == null || template?.keySalt == null) {
        setStatus('Encrypted collection is missing its wrapped key — cannot decrypt.', 'error'); return
      }
      const K = unwrapContentKey(template.wrappedKey, template.keySalt)
      if (K == null) { setStatus('Could not unwrap the content key.', 'error'); return }
      let plain: number[]
      try { plain = decryptContent(file.fileBytes, K) } catch { setStatus('Decryption failed (wrong key or corrupt ciphertext).', 'error'); return }
      showFile(collectionName, { mimeType: file.mimeType, fileName: file.fileName, fileBytes: plain }, verified)
      setStatus(verified ? '🔓 Decrypted — ciphertext matches the collection commitment ✓.' : '⚠ Decrypted, but the ciphertext hash does NOT match the collection!', verified ? 'ok' : 'error')
    } else {
      showFile(collectionName, file, verified)
      setStatus(
        verified
          ? 'File loaded — SHA-256 matches the collection (bound to identity ✓).'
          : '⚠ File loaded, but its hash does NOT match the collection commitment!',
        verified ? 'ok' : 'error',
      )
    }
  } catch (e) {
    setStatus(`View failed: ${(e as Error).message}`, 'error')
  }
}

function showFile(title: string, file: { mimeType: string; fileName: string; fileBytes: number[] }, verified: boolean): void {
  const content = $('viewerContent')
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null }
  viewerUrl = URL.createObjectURL(new Blob([new Uint8Array(file.fileBytes)], { type: file.mimeType }))
  $('viewerTitle').textContent =
    `${title} — ${file.fileName} · ${file.mimeType} · ${file.fileBytes.length} bytes ${verified ? '✓' : '⚠ hash mismatch'}`
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
function renderTokens(): void {
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
  if (active.length === 0) { host.innerHTML = '<p class="muted">No tokens yet. Mint a collection or Check Incoming.</p>'; return }
  host.innerHTML = `<p class="muted" style="font-size:12px;margin:0 0 8px">${active.length} held — newest first</p>`
  for (const t of active) {
    const card = document.createElement('div')
    card.className = 'token'
    const stateText = t.stateData && t.stateData !== '00' ? safeUtf8(t.stateData) : ''
    const isEdition = t.kind === 'edition'
    card.innerHTML = `
      <div class="token-name">${escapeHtml(t.collectionName ?? 'Collection')}${isEdition ? ' <span class="badge">edition</span>' : ''}</div>
      <div class="mono">collection ${short(t.collectionId)}</div>
      <div class="mono">utxo ${short(t.txId)}:${t.outputIndex}</div>
      ${stateText ? `<div class="state">state: ${escapeHtml(stateText)}</div>` : ''}
      ${t.sellerNote ? `<div class="state" style="color:var(--accent2)">📝 ${escapeHtml(t.sellerNote)}</div>` : ''}
      ${t.bonusValue ? (t.bonusKind === 'link'
        ? `<div class="state">🎁 <a href="${escapeHtml(t.bonusValue)}" target="_blank" rel="noopener" class="bonus-claim">Claim your bonus ↗</a></div>`
        : `<div class="state">🎁 Bonus code: <span class="mono">${escapeHtml(t.bonusValue)}</span></div>`) : ''}
    `
    const verify = document.createElement('button')
    verify.textContent = 'Verify'
    verify.className = 'secondary'
    verify.onclick = () => void onVerify(t.txId, t.outputIndex)
    const actions = document.createElement('div')
    actions.className = 'actions'

    if (isEdition) {
      const replicate = document.createElement('button')
      replicate.textContent = 'Replicate'
      replicate.onclick = () => void onReplicate(t)
      const xfer = document.createElement('button')
      xfer.textContent = 'Transfer'
      xfer.className = 'secondary'
      xfer.onclick = () => void onTransferEdition(t)
      const view = document.createElement('button')
      view.textContent = 'View'
      view.className = 'secondary'
      view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Edition')
      const sales = document.createElement('button')
      sales.textContent = 'Sales page'
      sales.className = 'secondary'
      sales.onclick = () => onOpenSalesPage(t)
      actions.append(replicate, xfer, view, sales, verify)
    } else {
      const send = document.createElement('button')
      send.textContent = 'Send'
      send.onclick = () => void onSend(t.txId, t.outputIndex)
      const view = document.createElement('button')
      view.textContent = 'View'
      view.className = 'secondary'
      view.onclick = () => void onView(t.collectionId, t.collectionName ?? 'Collection')
      actions.append(send, verify, view)
    }
    card.append(actions)
    host.append(card)
  }
}

function safeUtf8(hex: string): string {
  try { return Utils.toUTF8(Utils.toArray(hex, 'hex')) } catch { return hex }
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
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
  creatorPubKeyHex: string | null
  fees: { creator: number; holder: number } | null
  /** v2 (percentage pricing): creator basis points + the genesis/reference price (the seller's live price is
   *  resolved at buy time). */
  isV2: boolean
  cBps: number
  v2PriceSats: number
  /** The collection's covenant template bytes (hex) — lets the buy flow reconstruct a holder's edition. */
  covenantHex: string
}

let cvObjectUrl: string | null = null
let currentCollection: { info: CollectionInfo; holderPubKey: string | null } | null = null
/** The seller's current note (promo + optional bonus) for the open collection, captured onto a purchase. */
let cvNote: SellerNote | null = null

function setCvStatus(msg: string, kind: 'info' | 'error' = 'info'): void {
  const el = $('cvStatus')
  el.textContent = msg
  el.className = `cv-status ${kind === 'error' ? 'error' : ''}`.trim()
}

/** Read a `#c=…&h=…` hash route, or null if absent. */
function parseHashRoute(): { c: string; h: string | null } | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const c = params.get('c')
  if (!c) return null
  return { c, h: params.get('h') }
}

/** Fetch TX1 and extract everything the storefront page needs (template + storefront + fees). */
async function loadCollection(tx1Ref: string): Promise<CollectionInfo> {
  const tx1 = await provider.getSourceTransaction(tx1Ref)
  let template: TemplateFields | undefined
  let creatorPubKeyHex: string | null = null
  let storefront: { description: string; coverMimeType?: string; coverBytes?: number[] } | null = null
  let hasContentFile = false
  for (const o of tx1.outputs) {
    const t = parseTemplateScript(o.lockingScript)
    if (t) { template = t.fields; creatorPubKeyHex = t.creatorPubKeyHex }
    const s = parseStorefrontScript(o.lockingScript)
    if (s) storefront = s.fields
    if (parseFileScript(o.lockingScript)) hasContentFile = true
  }
  if (!template) throw new Error('not a PHAR LAP collection (no template output in TX1)')
  const rules = decodeTokenRules(template.tokenRules)
  let fees: { creator: number; holder: number } | null = null
  let isV2 = false, cBps = 0, v2PriceSats = 0
  if (template.covenantScript) {
    try {
      const ed = parseEditionAny(LockingScript.fromHex(template.covenantScript))
      if (ed?.isV2) { isV2 = true; cBps = ed.terms.cBps; v2PriceSats = ed.priceSats }
      else if (ed) fees = { creator: ed.terms.creatorFeeSats, holder: ed.terms.holderFeeSats }
    } catch { /* leave null — non-replicable or unparseable covenant */ }
  }
  const cover = storefront?.coverBytes
    ? { mimeType: storefront.coverMimeType ?? 'application/octet-stream', bytes: storefront.coverBytes }
    : null
  return {
    tx1Ref, name: template.tokenName, description: storefront?.description ?? '',
    cover, encrypted: rules.isEncrypted, replicable: rules.isReplicable, hasContentFile,
    creatorPubKeyHex, fees, isV2, cBps, v2PriceSats, covenantHex: template.covenantScript,
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
  $('cvCreator').textContent = info.creatorPubKeyHex ? `by ${short(info.creatorPubKeyHex)}` : ''
  $('cvDesc').textContent = info.description || '(no description provided)'
  if (info.isV2) {
    $('cvPrice').innerHTML = `Get your own copy — <b>${info.v2PriceSats} sat</b> <span class="muted">` +
      `(reseller's price; creator takes ${(info.cBps / 100).toFixed(2)}% = ${Math.floor(info.v2PriceSats * info.cBps / 10000)} sat, plus a small network fee)</span>`
  } else if (info.fees) {
    $('cvPrice').innerHTML = `Get your own copy — <b>${info.fees.creator + info.fees.holder} sat</b> <span class="muted">(creator ${info.fees.creator} + holder ${info.fees.holder}, plus a small network fee)</span>`
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

async function openCollectionView(tx1Ref: string, holderPubKey: string | null): Promise<void> {
  $('collectionView').style.display = 'flex'
  hideFundPrompt()
  $('cvTitle').textContent = 'Loading…'
  $('cvCover').innerHTML = ''
  $('cvBadges').innerHTML = ''
  $('cvCreator').textContent = ''
  $('cvDesc').textContent = ''
  $('cvPrice').innerHTML = ''
  setCvStatus('Loading collection from the chain…')
  try {
    const info = await loadCollection(tx1Ref)
    currentCollection = { info, holderPubKey }
    renderCollectionView(info)
    setCvStatus('')
    // Resolve the seller's current promo note (async, best-effort) for the link's seller.
    void loadSellerNote(info, holderPubKey ?? info.creatorPubKeyHex)
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

function shareCollectionLink(): void {
  if (!currentCollection) return
  const { info, holderPubKey } = currentCollection
  // Share from the perspective of the current seller: prefer the routed holder, else this wallet's pubkey.
  const h = holderPubKey ?? pubKeyHex
  const link = `${location.origin}${location.pathname}#c=${info.tx1Ref}&h=${h}`
  void navigator.clipboard?.writeText(link)
  setCvStatus('Share link copied to clipboard.')
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
  $('cvFundNeed').textContent = `${needed} sat`
  $('cvFundHave').textContent = `${have} sat`
  $('cvFundAddr').textContent = address
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
  const sellerPub = holderPubKey ?? info.creatorPubKeyHex
  if (!sellerPub) { setCvStatus('No seller could be determined for this link.', 'error'); return }

  buying = true
  ;($('cvGet') as HTMLButtonElement).disabled = true
  try {
    setCvStatus('Finding the seller’s current edition…')
    let tip = await resolveHolderEdition(provider, { tx1RefHex: info.tx1Ref, holderPubKeyHex: sellerPub, templateCovenantHex: info.covenantHex })
    if (!tip) { setCvStatus('This seller has no edition available right now — try another link or ask them to mint one.', 'error'); return }

    // Price = the seller's actual price (v2: their set price split by %; v1: fixed fees).
    const creatorCut = tip.isV2 ? Math.floor((tip.priceSats * info.cBps) / 10000) : tip.terms.creatorFeeSats
    const resellerCut = tip.isV2 ? tip.priceSats - creatorCut : tip.terms.holderFeeSats
    const price = creatorCut + resellerCut
    const ok = confirm(
      `Buy a copy of “${info.name}” for ${price} sat?\n\n` +
      (tip.isV2
        ? `creator ${(info.cBps / 100).toFixed(2)}% = ${creatorCut} + reseller ${resellerCut} sat, plus a small network fee.\n`
        : `creator ${creatorCut} + holder ${resellerCut} sat, plus a small network fee.\n`) +
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
          ? await replicateEditionV2(provider, key, { editionTxId: tip.txId, editionOutputIndex: tip.outputIndex, editionLockHex: tip.lockHex })
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
      (echoNote?.bonusValue ? '\n🎁 Bonus included — claim it below / on the token card.' : ''),
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

function init(): void {
  store = new PharLapStore()
  useKey(loadKey())
  renderTokens()

  $('btnRefresh').onclick = () => void refreshBalance()
  $('btnMint').onclick = () => void onMint()
  $('btnV2Probe').onclick = () => void onV2Probe()
  $('btnMintEdition').onclick = () => void onMintEdition()
  $('btnV2SelfTest').onclick = () => void onV2SelfTest()
  ;($('edMode') as HTMLSelectElement).onchange = syncMintMode
  syncMintMode()
  $('btnIncoming').onclick = () => void onCheckIncoming()
  $('btnSendMessage').onclick = () => void onSendMessage()
  $('btnCheckMessages').onclick = () => void onCheckMessages()
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
  $('viewerClose').onclick = () => closeViewer()
  $('viewer').onclick = (e) => { if (e.target === $('viewer')) closeViewer() } // click backdrop to close

  // Collection / sales view (shareable links).
  $('cvWallet').onclick = () => closeCollectionView()
  $('cvShare').onclick = () => shareCollectionLink()
  $('cvGet').onclick = () => void onGetCopy()
  $('cvView').onclick = () => { if (currentCollection) void onView(currentCollection.info.tx1Ref, currentCollection.info.name) }
  $('cvNoteSave').onclick = () => void onSaveSellerNote()
  $('cvFundCopy').onclick = () => void navigator.clipboard?.writeText(address)
  $('cvFundDone').onclick = () => void onGetCopy()
  window.addEventListener('hashchange', () => {
    const r = parseHashRoute()
    if (r) void openCollectionView(r.c, r.h)
    else closeCollectionView()
  })

  // If the page was opened via a share link, show the storefront over the wallet.
  const route = parseHashRoute()
  if (route) void openCollectionView(route.c, route.h)

  void refreshBalance()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
