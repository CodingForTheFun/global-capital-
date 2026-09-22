import { handleEvaluate } from '../lib/gateway.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const { status, body } = await handleEvaluate({ method: req.method, headers: req.headers, body: req.body });
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}
