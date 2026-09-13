export interface Book { readonly id:string; readonly name:string; readonly type:'dfs'|'exchange'|'sportsbook'|'sweepstakes'; readonly badgeColor:string; }
export const BOOKS: readonly Book[];
export function bookId(value:unknown):string;
export function bookInfo(value:unknown):Book;
export function bookSelection(value:unknown):string[]|null;
export function bookEnabled(row:Record<string,unknown>,selection:string[]|null):boolean;
export function filterBookGroups<T extends {rows:Record<string,unknown>[];comparisonOffers?:Record<string,unknown>[]}>(groups:T[],selection:string[]|null):T[];
