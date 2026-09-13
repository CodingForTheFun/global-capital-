import assert from 'node:assert/strict';
// Attribute overflow to this navigation, not unrelated pre-existing tables.
export async function assertWorkspaceHeader(page) {
  const nav = page.locator('.as5 .edge-workspace-nav');
  await nav.getByRole('link', { name: 'Auto Scout', exact: true }).scrollIntoViewIfNeeded();
  const bounds = await nav.evaluate(element => {
    const box = element.getBoundingClientRect();
    const header = element.closest('.asTop').getBoundingClientRect();
    const sports = element.parentElement.querySelector('.asSports')?.getBoundingClientRect();
    const active = element.querySelector('[aria-current="page"]');
    const link = active.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.min(link.right - 2, innerWidth - 2), (link.top + link.bottom) / 2);
    const pageWidth = document.documentElement.scrollWidth;
    const display = element.style.display;
    element.style.display = 'none';
    const originalPageWidth = document.documentElement.scrollWidth;
    element.style.display = display;
    return { left:box.left, right:box.right, height:box.height, bottom:box.bottom, headerBottom:header.bottom,
      sportsTop:sports?.top ?? null, activeIsClickable:hit === active || active.contains(hit),
      viewportWidth:innerWidth, pageWidth, originalPageWidth };
  });
  console.log('WORKSPACE_HEADER_BOUNDS', JSON.stringify(bounds));
  const detail = JSON.stringify(bounds);
  assert.ok(bounds.height >= 44, `Touch-sized navigation: ${detail}`);
  assert.ok(bounds.bottom <= bounds.headerBottom + 1, `Header flow: ${detail}`);
  assert.ok(bounds.sportsTop === null || bounds.bottom <= bounds.sportsTop + 1, `No overlapping sport pills: ${detail}`);
  assert.ok(bounds.activeIsClickable, `Unobstructed Auto Scout link: ${detail}`);
  assert.ok(bounds.left >= -1 && bounds.right <= bounds.viewportWidth + 1, `Navigation fits viewport: ${detail}`);
  assert.ok(bounds.pageWidth <= Math.max(bounds.originalPageWidth, bounds.viewportWidth) + 1, `No additional page overflow: ${detail}`);
  return bounds;
}
