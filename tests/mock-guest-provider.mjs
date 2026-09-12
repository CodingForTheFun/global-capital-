// CI-only preload. Never loaded by production commands. Refuse real credentials.
if (process.env.GEMINI_API_KEY !== 'edge-ci-fixture-only') throw new Error('Fixture loader is test-only');
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const target = String(input instanceof Request ? input.url : input);
  if (target.startsWith('https://generativelanguage.googleapis.com/')) {
    const body = JSON.parse(options.body);
    const raw = body.contents[0].parts[0].text.split('CARD:\n')[1].split('\nQUESTION:')[0];
    const card = JSON.parse(raw);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `In these sample results, ${card.summary.hits} games hit and ${card.summary.pushes} pushed. These are illustrative numbers, not a prediction or betting advice.` }] } }] }), { headers: { 'content-type': 'application/json' } });
  }
  return original(input, options);
};
