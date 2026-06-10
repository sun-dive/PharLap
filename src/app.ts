/**
 * PHAR LAP — browser wallet (single-page app).
 *
 * Wires the protocol modules (pushDrop / tokenCodec / collectionBuilder / transfer / verify)
 * to a minimal UI: wallet + balance, mint a collection, my tokens, send, check-incoming, verify.
 * Raw-key model: a WIF in localStorage; funding/broadcast/fetch via WoC (walletProvider);
 * verification via verifyTokenLineage. Tokens are tracked locally (PharLapStore) since PushDrop
 * outputs are not WoC-address-indexed.
 */
import { PrivateKey, PublicKey, Utils } from '@bsv/sdk'
import { WalletProvider } from './walletProvider.ts'
import { PharLapStore } from './pharlapStore.ts'
import { createCollection, getSafeUtxos } from './collectionBuilder.ts'
import { createTransfer, scanIncoming } from './transfer.ts'
import { verifyTokenLineage } from './verify.ts'
import { parseTemplateScript } from './tokenCodec.ts'

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

// ─── check incoming ─────────────────────────────────────────────────
async function onCheckIncoming(): Promise<void> {
  setStatus('Scanning address history for incoming tokens…')
  try {
    const incoming = await scanIncoming(provider, pubKeyHex)
    let added = 0
    for (const t of incoming) {
      // Verify lineage (structure + anchor) before recording.
      const tx = await provider.getSourceTransaction(t.txId)
      const v = await verifyTokenLineage(tx, t.outputIndex, { getRawTransaction: id => provider.getSourceTransaction(id) })
      if (!v.valid) continue
      if (store.add({ txId: t.txId, outputIndex: t.outputIndex, collectionId: t.fields.tx1Ref, stateData: t.fields.stateData })) added++
    }
    renderTokens()
    setStatus(`Scan complete: ${incoming.length} found, ${added} new and verified.`, 'ok')
  } catch (e) {
    setStatus(`Scan failed: ${(e as Error).message}`, 'error')
  }
}

// ─── verify ─────────────────────────────────────────────────────────
async function onVerify(txId: string, outputIndex: number): Promise<void> {
  setStatus('Verifying token lineage…')
  try {
    const tx = await provider.getSourceTransaction(txId)
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

// ─── token list ─────────────────────────────────────────────────────
function renderTokens(): void {
  const host = $('tokens')
  const active = store.active()
  if (active.length === 0) { host.innerHTML = '<p class="muted">No tokens yet. Mint a collection or Check Incoming.</p>'; return }
  host.innerHTML = ''
  for (const t of active) {
    const card = document.createElement('div')
    card.className = 'token'
    const stateText = t.stateData && t.stateData !== '00' ? safeUtf8(t.stateData) : ''
    card.innerHTML = `
      <div class="token-name">${escapeHtml(t.collectionName ?? 'Collection')}</div>
      <div class="mono">collection ${short(t.collectionId)}</div>
      <div class="mono">utxo ${short(t.txId)}:${t.outputIndex}</div>
      ${stateText ? `<div class="state">state: ${escapeHtml(stateText)}</div>` : ''}
    `
    const send = document.createElement('button')
    send.textContent = 'Send'
    send.onclick = () => void onSend(t.txId, t.outputIndex)
    const verify = document.createElement('button')
    verify.textContent = 'Verify'
    verify.className = 'secondary'
    verify.onclick = () => void onVerify(t.txId, t.outputIndex)
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(send, verify)
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
  $('btnIncoming').onclick = () => void onCheckIncoming()
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

  void refreshBalance()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
