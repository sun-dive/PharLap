<?php
// Mint a short code for a collection share link. Stores ONLY public data: the collection txid, the holder
// pubkey, and the (public) referral code. NEVER the gift voucher key — that stays client-side, in the
// link's #hash, and is never sent here. Deterministic: the same {txid, holder, aff} always maps to the same
// code, so re-sharing a collection yields a stable short link with no duplicate entries.

header('Content-Type: application/json');
function fail($c, $m) { http_response_code($c); echo json_encode(['ok' => false, 'error' => $m]); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 4096) fail(413, 'too large');
$body = json_decode($raw, true);
if (!is_array($body)) fail(400, 'bad json');

$txid   = isset($body['txid'])   ? strtolower($body['txid'])   : '';
$holder = isset($body['holder']) ? strtolower($body['holder']) : '';
$aff    = isset($body['aff'])    ? trim((string)$body['aff'])  : '';
if (!preg_match('/^[0-9a-f]{64}$/', $txid))   fail(400, 'bad txid');
if (!preg_match('/^[0-9a-f]{66}$/', $holder)) fail(400, 'bad holder');
if ($aff !== '' && !preg_match('/^[0-9A-Fa-f-]{1,64}$/', $aff)) $aff = '';

$dir = __DIR__ . '/links';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
if (!is_dir($dir) || !is_writable($dir)) fail(500, 'store unavailable');

// Deterministic 8-char base62 code from the target (low ~48 bits of a sha256 → ample for any realistic count).
$hash = hash('sha256', "$txid|$holder|$aff", true);
$n = 0; for ($i = 0; $i < 6; $i++) $n = ($n << 8) | ord($hash[$i]);
$alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
$code = ''; for ($i = 0; $i < 8; $i++) { $code .= $alphabet[$n % 62]; $n = intdiv($n, 62); }

$file = "$dir/$code.json";
if (!is_file($file)) {
  file_put_contents($file, json_encode(['txid' => $txid, 'holder' => $holder, 'aff' => $aff], JSON_UNESCAPED_UNICODE));
}
echo json_encode(['ok' => true, 'code' => $code]);
