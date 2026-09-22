import { handleHealth } from '../lib/gateway.js';

export default function handler(req, res) {
  const { status, body } = handleHealth();
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}
