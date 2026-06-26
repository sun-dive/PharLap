<?php
// Per-collection Open Graph for link previews. Crawlers (Telegram / X / Facebook …) read these tags from
// server-rendered HTML — they don't run JS and never receive the URL #hash. So the collection id is in the
// PATH (/c/<txid>, rewritten here by .htaccess), while the holder + gift voucher stay in the #hash, which is
// client-only — THE VOUCHER KEY NEVER REACHES THIS SERVER. Preview assets (cover + title/desc) are pushed by
// the wallet when it builds a share link (register.php), so this page never touches the chain or WoC.

$txid = isset($_GET['c']) ? strtolower($_GET['c']) : '';
if (!preg_match('/^[0-9a-f]{64}$/', $txid)) { header('Location: /'); exit; }

$base  = 'https://smartnfts.com';
$title = 'SMART NFTs — content you own that pays you as it spreads';
$desc  = 'Publish content as a Smart NFT buyers truly own — self-replicating, with publisher and holder royalties enforced on-chain by BSV.';
$image = $base . '/brand/og-banner.jpg';
$haveCover = false;

$metaFile = __DIR__ . '/og/' . $txid . '.json';
$imgFile  = __DIR__ . '/og/' . $txid . '.jpg';
if (is_file($metaFile)) {
  $meta = json_decode(@file_get_contents($metaFile), true);
  if (is_array($meta)) {
    if (!empty($meta['title']))       $title = $meta['title'];
    if (!empty($meta['description'])) $desc  = $meta['description'];
  }
}
if (is_file($imgFile)) { $image = $base . '/og/' . $txid . '.jpg'; $haveCover = true; }

function e($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
header('Content-Type: text/html; charset=UTF-8');
?><!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title><?= e($title) ?></title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SMART NFTs" />
<meta property="og:title" content="<?= e($title) ?>" />
<meta property="og:description" content="<?= e($desc) ?>" />
<meta property="og:url" content="<?= e($base . '/c/' . $txid) ?>" />
<meta property="og:image" content="<?= e($image) ?>" />
<?php if (!$haveCover): ?>
<meta property="og:image:width" content="1344" />
<meta property="og:image:height" content="768" />
<?php endif; ?>
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="<?= e($title) ?>" />
<meta name="twitter:description" content="<?= e($desc) ?>" />
<meta name="twitter:image" content="<?= e($image) ?>" />
<script>
// Real visitors only (crawlers ignore this): rebuild the full app route, carrying the holder + gift voucher
// that live in THIS page's #hash (never sent to the server), then hand off to the SPA at the root.
(function () {
  try {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    var out = new URLSearchParams();
    out.set('c', <?= json_encode($txid) ?>);
    ['h', 'g', 'aff'].forEach(function (k) { if (p.get(k)) out.set(k, p.get(k)); });
    location.replace('/#' + out.toString());
  } catch (e) { location.replace('/'); }
})();
</script>
</head><body style="background:#0d1117">
<p style="font-family:system-ui,sans-serif;color:#8b949e;padding:24px">Opening <?= e($title) ?>…</p>
</body></html>
