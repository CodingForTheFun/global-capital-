// Customer-facing brand cleanup for the signed-out account gate.
//
// Auto Scout remains an internal engine/runtime name in env vars, routes and
// data attributes. This patch only changes HTML that a signed-out customer can
// see. It is applied while frontdoor-clearsports builds the production runtime
// so we do not fork the auth implementation or alter account behavior.
export function patchObligePublicBrandFrontdoor(source) {
  const before = `  const body = landingPage({
    passwordSignup: health.passwordSignup,
    googleSignup: health.googleSignup,
    beta: health.beta,
    // Send them back where they were headed once they are in.
    next: url.pathname === '/' ? '/' : url.pathname + url.search,
  });`;
  const after = `  const body = landingPage({
    passwordSignup: health.passwordSignup,
    googleSignup: health.googleSignup,
    beta: health.beta,
    // Send them back where they were headed once they are in.
    next: url.pathname === '/' ? '/' : url.pathname + url.search,
  })
    .replace('<title>Auto Scout — Prop Intelligence &amp; Line Discrepancies</title>', '<title>Oblige Props — Player Prop Research &amp; Line Comparison</title>')
    .replace('<span class="brand">AUTOSCOUT</span>', '<span class="brand">OBLIGE PROPS</span>')
    .replace('Auto Scout is a research tool.', 'Oblige Props is a research tool.');`;

  if (!source.includes(before)) {
    throw new Error('Oblige Props public-brand patch could not locate the signed-out landing gate.');
  }
  const patched = source.replace(before, after);
  if (patched === source || !patched.includes('Oblige Props is a research tool.')) {
    throw new Error('Oblige Props public-brand patch did not apply.');
  }
  return patched;
}
