<?php
// Per-collection Open Graph for link previews. Crawlers (Telegram / X / Facebook …) read these tags from
// server-rendered HTML — they don't run JS and never receive the URL #hash. So the collection id is in the
// PATH (/c/<txid>, rewritten here by .htaccess), while the holder + gift voucher stay in the #hash, which is
// client-only — THE VOUCHER KEY NEVER REACHES THIS SERVER. Preview assets (cover + title/desc) are pushed by
// the wallet when it builds a share link (register.php), so this page never touches the chain or WoC.

// Resolve the target. A short code (/s/<code>) maps to {txid, holder, aff} (PUBLIC data only); a direct
// /c/<txid> carries just the txid in the path (holder + voucher live in the #hash, client-side).
$txid = ''; $holder = ''; $aff = '';
if (isset($_GET['s']) && preg_match('/^[0-9A-Za-z]{1,16}$/', $_GET['s'])) {
  $f = __DIR__ . '/links/' . $_GET['s'] . '.json';
  if (is_file($f)) {
    $rec = json_decode(@file_get_contents($f), true);
    if (is_array($rec)) { $txid = strtolower($rec['txid'] ?? ''); $holder = strtolower($rec['holder'] ?? ''); $aff = (string)($rec['aff'] ?? ''); }
  }
}
if ($txid === '' && isset($_GET['c'])) $txid = strtolower($_GET['c']);
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
// Real visitors only (crawlers ignore this): rebuild the full app route. Holder + referral come from the
// short code when present (server-injected below), else from this page's #hash; the gift voucher ALWAYS
// comes from the #hash (client-only — never sent to the server). Then hand off to the SPA at the root.
(function () {
  try {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    var out = new URLSearchParams();
    out.set('c', <?= json_encode($txid) ?>);
    var h = <?= json_encode($holder) ?> || p.get('h'); if (h) out.set('h', h);
    var aff = <?= json_encode($aff) ?> || p.get('aff'); if (aff) out.set('aff', aff);
    if (p.get('g')) out.set('g', p.get('g'));
    location.replace('/#' + out.toString());
  } catch (e) { location.replace('/'); }
})();
</script>
</head><body style="background:#0d1117">
<p style="font-family:system-ui,sans-serif;color:#8b949e;padding:24px">Opening <?= e($title) ?>…</p>
</body></html>
