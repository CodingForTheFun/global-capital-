// Run the deployed frontdoor locally, honoring the preview runner's port.
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
if (portIndex !== -1) {
  const port = Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid development port');
  process.env.PORT = String(port);
}
process.env.DEMO_MODE = 'false';
process.env.AUTO_SCAN_MINUTES = '0';
await import('../frontdoor-clearsports.mjs');
