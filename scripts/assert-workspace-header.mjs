import assert from 'node:assert/strict';
// Screenshots exposed a fixed-height header overlap not detected by isVisible.
// Assert geometry and hit targets, not just presence in the DOM.
export async function assertWorkspaceHeader(page) {
  const nav = page.locator('.as5 .edge-workspace-nav');
  const active = nav.getByRole('link', { name: 'Auto Scout', exact: true });
  await active.scrollIntoViewIfNeeded();
  const bounds = await nav.evaluate(element => {
    const box = element.getBoundingClientRect();
    const header = element.closest('.asTop').getBoundingClientRect();
    const sports = element.parentElement.querySelector('.asSports')?.getBoundingClientRect();
    const active = element.querySelector('[aria-current="page"]');
    const link = active.getBoundingClientRect();
    const x = Math.min(link.right - 2, innerWidth - 2);
    const y = (link.top + link.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      height: box.height, bottom: box.bottom, headerBottom: header.bottom,
      sportsTop: sports?.top ?? Infinity,
      activeIsClickable: hit === active || active.contains(hit),
      viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
    };
  });
  assert.ok(bounds.height >= 44, 'Auto Scout navigation has touch-sized height');
  assert.ok(bounds.bottom <= bounds.headerBottom + 1, 'Navigation is inside header flow');
  assert.ok(bounds.bottom <= bounds.sportsTop + 1, 'Sport pills do not overlap navigation');
  assert.ok(bounds.activeIsClickable, 'Active Auto Scout link is visible and unobstructed');
  assert.ok(bounds.pageWidth <= bounds.viewportWidth + 1, 'Auto Scout navigation causes no page-wide overflow');
  return bounds;
}
