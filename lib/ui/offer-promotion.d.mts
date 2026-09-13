export const TACO_FRESHNESS_MS: number;
export function verifiedTaco(offer: unknown, now?: number): {offerId: string; expiresAt: string; validUntil: number} | null;
export function tacoBadgeHtml(offer: unknown, now?: number): string;
export function removeExpiredTacoBadges(root: ParentNode, now?: number): void;
export function verifiedTacoChannelOffer(offer: unknown, sport: string, now?: number): {offerId: string; validUntil: number} | null;
