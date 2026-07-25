<?php
// nft.sale — on-demand preview refresh (manual trigger), QUEUE model.
//
// The web request context is memory-capped too tightly to run Node's fetch (undici's WASM HTTP parser OOMs on
// this host), so this endpoint does NO chain work. It simply appends the collection id to a queue file. The
// curation cron — which has the memory + network — drains that queue on its next run and re-resolves those
// previews (force, bypassing write-once). So a re-tagged clip goes live on the next cron tick.
//
// Lives in the nft.sale web root. It does NO chain work and holds NO secret — it only appends a valid 64-hex
// collection id to a queue file, and the cron drains that queue at a bounded pace, so no auth is needed.
//
// Usage:  https://nft.sale/refresh.php?collection-id=<64-hex-collection-id>   (?c= also accepted)

header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // public endpoint (no secret, no chain work) — safe for any origin (e.g. Phar Lap's "refresh note" button)

// ── Config ──────────────────────────────────────────────────────────────────────────────────────────────
$QUEUE  = __DIR__ . '/cgi-bin/refresh.queue';                 // the cron reads this (BIGRED_DIR/cgi-bin/refresh.queue)

// ── Input validation ────────────────────────────────────────────────────────────────────────────────────
$collectionId = strtolower($_GET['collection-id'] ?? $_GET['c'] ?? ''); // the Collection ID (= its genesis txid); ?c= kept for back-compat
if (!preg_match('/^[0-9a-f]{64}$/', $collectionId)) { http_response_code(400); exit("bad collection-id — expected 64 hex chars\n"); }

// ── Enqueue (skip if already queued so repeats don't pile up) ───────────────────────────────────────────
$queued = is_readable($QUEUE) ? array_filter(array_map('trim', file($QUEUE))) : [];
if (!in_array($collectionId, $queued, true)) {
  if (@file_put_contents($QUEUE, $collectionId . "\n", FILE_APPEND | LOCK_EX) === false) {
    http_response_code(500);
    exit("could not write queue at $QUEUE — check that the web user can write cgi-bin/\n");
  }
}
echo "queued $collectionId\n\nIt will refresh on the next curation cron run.\n";
