/** Decorative companion to a visible variant label. Never infer a variant from its line. */
export function DfsVariantIcon({ variant }: { variant?: string | null }) {
  if (variant !== 'demon' && variant !== 'goblin') return null;
  const demon = variant === 'demon';
  return <svg data-dfs-icon={variant} aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, marginRight: 4, color: demon ? '#ff667b' : '#59e3a4' }}>
    {demon ? <path fill="currentColor" d="M4 2 9 7a11 11 0 0 1 6 0l5-5v8a8 8 0 1 1-16 0Z"/> : <path fill="currentColor" d="m1 6 6 2a7 7 0 0 1 10 0l6-2-3 8-2 1a6 6 0 0 1-12 0l-2-1Z"/>}
    <path fill="#101522" d="m6.5 10 4 1.5-1 2-2.5-.5Zm11 0-4 1.5 1 2 2.5-.5Z"/>
    <path d="M8.5 16c2 2 5 2 7 0" fill="none" stroke="#101522" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>;
}
