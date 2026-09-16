import test from 'node:test';
import assert from 'node:assert/strict';
import { patchProplinePushBoardCore, patchProplinePushBoardUi } from '../lib/autoscout/propline-push-board-runtime-patch.mjs';

test('push-board core patch records webhook events and overlays customer props', () => {
  const source = [
    "import { handleProplineRealtimeEvent, proplineRealtimeSnapshot, proplineRealtimeHealth, startProplineRealtime } from '../lib/data-sources/propline/realtime.mjs';",
    "if (url.pathname === PROPLINE_WEBHOOK_PATH) return handleProplineWebhook(req, res, { onEvent: handleProplineRealtimeEvent });",
    "const rawBoard = await fetchUnifiedBoard(sport, { signal: controller.signal, includeAlternates });",
    "const health = { proplineWebhook: proplineWebhookHealth(), proplineRealtime: proplineRealtimeHealth() };",
    "startProplineRealtime();",
  ].join('\n');
  const patched = patchProplinePushBoardCore(source);
  assert.match(patched, /live-board-overlay\.mjs/);
  assert.match(patched, /delivery-health\.mjs/);
  assert.match(patched, /recordProplineLiveBoardEvent\(event\)/);
  assert.match(patched, /applyProplineLiveBoardOverlay\(await fetchUnifiedBoard/);
  assert.match(patched, /proplinePushBoard: proplineLiveBoardOverlayHealth\(\)/);
  assert.match(patched, /proplineDeliveries: proplineDeliveryHealth\(\)/);
  assert.match(patched, /startProplineDeliveryHealthMonitor\(\)/);
});

test('push-board UI watcher only watches local live-move state and refreshes the existing board', () => {
  const patched = patchProplinePushBoardUi("document.getElementById('asRefresh').onclick=()=>load();");
  assert.match(patched, /obligePropsPushBoardWatcher/);
  assert.match(patched, /\/api\/apex\/live-moves/);
  assert.match(patched, /setTimeout\(check,5000\)/);
  assert.match(patched, /refresh\.click\(\)/);
  assert.doesNotMatch(patched, /api\.prop-line\.com/);
  new Function(patched);
});
