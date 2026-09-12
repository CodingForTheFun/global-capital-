import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// Only visible product identity and style links change. Do not replace the
// production files with the older PR #41 versions (they predate live fixes).
for (const file of ['public/index.html', 'public/checkout.html', 'public/manifest.webmanifest', 'payments/paypal.mjs', 'apex-v2/scout-ui-v5.js']) {
  if (!existsSync(file)) continue;
  let text = readFileSync(file, 'utf8');
  text = text.replaceAll('AutoProp Scout Pro', 'ObligePay Edge').replaceAll('<b>AutoProp</b><em>Scout Pro</em>', '<b>ObligePay</b><em>Edge</em>');
  if (file === 'apex-v2/scout-ui-v5.js') text = text.replaceAll('Auto Scout', 'ObligePay Edge');
  if (file.endsWith('.html') && !text.includes('/assets/edge-theme.css')) text = text.replace('</head>', '<link rel="stylesheet" href="/assets/edge-theme.css" />\n</head>');
  if (file.endsWith('.webmanifest')) { const data = JSON.parse(text); data.name = 'ObligePay Edge'; data.short_name = 'ObligePay'; text = JSON.stringify(data, null, 2) + '\n'; }
  writeFileSync(file, text);
}
console.log('[edge] production identity prepared without changing account/provider contracts');
