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
import { PrivateKey, Utils, Hash } from '@bsv/sdk'
import { WalletProvider } from './walletProvider.ts'
import { PharLapStore } from './pharlapStore.ts'
import { createCollection, getSafeUtxos } from './collectionBuilder.ts'
import { createEdition, replicateEdition, transferEdition, broadcastV2Probe, scanIncomingEditions, type EditionTerms } from './editionBuilder.ts'
import { parseEditionScript } from './covenant.ts'
import { createTransfer, scanIncoming } from './transfer.ts'
import { sendMessage, scanIncomingMessages, type IncomingMessage } from './messageBuilder.ts'
import type { Part } from './messageCodec.ts'
import type { StoredToken } from './pharlapStore.ts'
import { verifyTokenLineage } from './verify.ts'
import { parseTemplateScript, parseFileScript, decodeTokenRules, type TemplateFields } from './tokenCodec.ts'
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

function storeEdition(o: { txId: string; outputIndex: number; lockHex: string }, collectionId: string, name: string, terms: EditionTerms): void {
  store.add({
    txId: o.txId, outputIndex: o.outputIndex, collectionId, stateData: '', collectionName: name,
    kind: 'edition', lockHex: o.lockHex, creatorPubKeyHashHex: Utils.toHex(terms.creatorPubKeyHash),
    creatorFeeSats: terms.creatorFeeSats, holderFeeSats: terms.holderFeeSats,
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

async function onMintEdition(): Promise<void> {
  const name = val('edName')
  if (!name) { setStatus('Enter an edition collection name.', 'error'); return }
  const count = Math.max(1, parseInt(val('edCount') || '1', 10))
  const encrypt = ($('edEncrypt') as HTMLInputElement).checked
  const terms = ownTerms()
  try {
    const file = await readFile($('edFile') as HTMLInputElement)
    if (encrypt && !file) { setStatus('Encryption needs a file — attach one or uncheck encrypt.', 'error'); return }
    setStatus(`Minting ${encrypt ? 'encrypted ' : ''}edition collection (TX1 template + TX2 covenant editions)…`)
    const result = await createEdition(provider, key, { tokenName: name, terms, mintCount: count, file, encrypt })
    for (const e of result.editions) storeEdition(e, result.collectionId, name, terms)
    renderTokens()
    setStatus(`Minted ${result.editions.length} edition(s). Collection ${short(result.collectionId)} (TX2 ${short(result.tx2Id)}).`, 'ok')
  } catch (e) {
    setStatus(`Edition mint failed: ${(e as Error).message}`, 'error')
  }
}

async function onReplicate(t: StoredToken): Promise<void> {
  if (!t.lockHex) { setStatus('Missing edition script; cannot replicate.', 'error'); return }
  setStatus('Replicating edition (permissionless mint)…')
  try {
    const r = await replicateEdition(provider, key, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex, terms: termsFromToken(t),
    })
    // The original UTXO is now spent; it was re-created at out[0] (token back to the holder = us, verbatim).
    store.markSent(t.txId, t.outputIndex)
    storeEdition({ txId: r.txId, outputIndex: 0, lockHex: t.lockHex },
      t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
    // The buyer's new replica (out[1]) is also ours in a self-test.
    storeEdition({ txId: r.replicaOutpoint.txId, outputIndex: r.replicaOutpoint.outputIndex, lockHex: r.lockHex },
      t.collectionId, t.collectionName ?? 'Edition', termsFromToken(t))
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
    const r = await transferEdition(provider, key, {
      editionTxId: t.txId, editionOutputIndex: t.outputIndex, editionLockHex: t.lockHex,
      newOwnerPubKey: Utils.toArray(recipient, 'hex'),
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
      if (store.add({
        txId: e.txId, outputIndex: e.outputIndex, collectionId: e.tx1RefHex, stateData: '', collectionName: 'Edition',
        kind: 'edition', lockHex: e.lockHex, creatorPubKeyHashHex: Utils.toHex(e.terms.creatorPubKeyHash),
        creatorFeeSats: e.terms.creatorFeeSats, holderFeeSats: e.terms.holderFeeSats,
      })) edAdded++
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
    const ed = parseEditionScript(tx.outputs[outputIndex]?.lockingScript)
    if (ed) {
      setStatus(`✅ Valid edition covenant — collection ${short(ed.tx1RefHex)}, owner ${short(ed.ownerPubKeyHex)}, fees ${ed.terms.creatorFeeSats}/${ed.terms.holderFeeSats} sat (structure verified).`, 'ok')
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
  // Newest first, so a freshly minted / just-received token appears at the TOP (not buried at the bottom).
  const active = [...store.active()].reverse()
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
      actions.append(replicate, xfer, view, verify)
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
function init(): void {
  store = new PharLapStore()
  useKey(loadKey())
  renderTokens()

  $('btnRefresh').onclick = () => void refreshBalance()
  $('btnMint').onclick = () => void onMint()
  $('btnV2Probe').onclick = () => void onV2Probe()
  $('btnMintEdition').onclick = () => void onMintEdition()
  $('btnIncoming').onclick = () => void onCheckIncoming()
  $('btnSendMessage').onclick = () => void onSendMessage()
  $('btnCheckMessages').onclick = () => void onCheckMessages()
  $('btnNewWallet').onclick = () => {
    if (!confirm('Replace the current wallet with a new random key? Your current key is in the WIF box — back it up first.')) return
    const k = PrivateKey.fromRandom()
    localStorage.setItem(WIF_KEY, k.toWif())
    useKey(k)
    setStatus('New wallet created.', 'ok')
  }
  $('btnRestore').onclick = () => {
    try {
      const k = PrivateKey.fromWif(val('restoreWif'))
      localStorage.setItem(WIF_KEY, k.toWif())
      useKey(k)
      setStatus('Wallet restored from WIF.', 'ok')
    } catch { setStatus('Invalid WIF.', 'error') }
  }
  $('btnCopyPub').onclick = () => void navigator.clipboard?.writeText(pubKeyHex)
  $('viewerClose').onclick = () => closeViewer()
  $('viewer').onclick = (e) => { if (e.target === $('viewer')) closeViewer() } // click backdrop to close

  void refreshBalance()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
