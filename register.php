<?php
// Cache the Open Graph assets (cover + title/description) the wallet pushes when it builds a share link, so
// share.php can render rich previews WITHOUT ever touching the chain. PUBLIC data only — never the gift
// voucher key (that stays client-side, in the link's #hash). Immutable: written once per collection.

header('Content-Type: application/json');
function fail($code, $msg) { http_response_code($code); echo json_encode(['ok' => false, 'error' => $msg]); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 3000000) fail(413, 'too large');   // ~3MB guard
$body = json_decode($raw, true);
if (!is_array($body)) fail(400, 'bad json');

$txid = isset($body['txid']) ? strtolower($body['txid']) : '';
if (!preg_match('/^[0-9a-f]{64}$/', $txid)) fail(400, 'bad txid');

$dir = __DIR__ . '/og';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
if (!is_dir($dir) || !is_writable($dir)) fail(500, 'cache dir unavailable');

$metaFile = "$dir/$txid.json";
$imgFile  = "$dir/$txid.jpg";
// Immutable (collection metadata is fixed in TX1): if already cached, accept idempotently.
if (is_file($metaFile)) { echo json_encode(['ok' => true, 'cached' => true]); exit; }

$title = isset($body['title']) ? mb_substr(trim((string)$body['title']), 0, 200) : '';
$desc  = isset($body['description']) ? mb_substr(trim((string)$body['description']), 0, 600) : '';

// Cover: a JPEG data URL (the wallet converts the cover to JPEG client-side). Decode, validate, cap size.
if (!empty($body['cover']) && preg_match('#^data:image/jpe?g;base64,(.+)$#', (string)$body['cover'], $m)) {
  $bytes = base64_decode($m[1], true);
  if ($bytes !== false && strlen($bytes) <= 2000000) {
    $info = @getimagesizefromstring($bytes);
    if ($info !== false && $info[2] === IMAGETYPE_JPEG) file_put_contents($imgFile, $bytes);
  }
}

file_put_contents($metaFile, json_encode(['title' => $title, 'description' => $desc], JSON_UNESCAPED_UNICODE));
echo json_encode(['ok' => true]);
