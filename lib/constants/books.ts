export type BookType = 'dfs' | 'exchange' | 'sportsbook' | 'sweepstakes';
export interface Book { readonly id: string; readonly name: string; readonly type: BookType; readonly badgeColor: string; }
// The runtime module is the sole registry, shared with the native Node/browser app.
export { BOOKS, bookId, bookInfo, bookSelection, bookEnabled, filterBookGroups } from './books.mjs';
