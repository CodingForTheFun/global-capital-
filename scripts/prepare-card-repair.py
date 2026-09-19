# Temporary, source-guarded preparation on the isolated repair branch only.
from pathlib import Path
import subprocess
root=Path('.')
expected={'terminal-board.tsx':'fa00461c2c5490638929abcd802d669bc22b0cd9','player-view.tsx':'56972ada3e0efeddec0b462ac6512a044df8c40c','face-card.tsx':'38e47de60db9f1e712e15805edcd234a2d92e67c','prop-workspace.tsx':'c5634cef997d18c43401239882fef36bf48a7157'}
for filename,sha in expected.items():
 path=root/'apps/oblige-web/components'/filename
 assert subprocess.check_output(['git','hash-object',str(path)],text=True).strip()==sha, 'Source changed; stop rather than overwrite another edit: '+filename

def r(s,a,b,n=1):
 assert s.count(a)==n,(a[:80],s.count(a));return s.replace(a,b)
p=root/'apps/oblige-web/components/terminal-board.tsx';s=p.read_text()
s=r(s,"import * as React from 'react';", "import * as React from 'react';\nimport { useRouter } from 'next/navigation';\nimport { collapsePlayerCards, groupPlayerCards, restrictBook, playerResearchHref, type PlayerCardGroup } from '@/lib/player-cards';")
s=r(s,'export function TerminalBoard() {','export function TerminalBoard() {\n  const router = useRouter();')
s=r(s,'  const [inspector, setInspector] = React.useState<PropGroup | null>(null);\n','')
s=r(s,'\n          setInspector(null);\n','\n')
s=r(s,'  const filtered = React.useMemo(() => {','  const matchingProps = React.useMemo(() => {')
s=r(s,'    return groups\n      .filter((group) => {','    return groups\n      .map(group => book === ALL ? group : restrictBook(group, book))\n      .filter((group) => {')
s=r(s,'  const page = React.useMemo(() => filtered.slice(0, shown), [filtered, shown]);','  const playerCards = React.useMemo(() => groupPlayerCards(groups), [groups]);\n  const filtered = React.useMemo(() => collapsePlayerCards(matchingProps, groups), [matchingProps, groups]);\n  const page = React.useMemo(() => filtered.slice(0, shown), [filtered, shown]);')
a=s.index('  const visibleBooks = React.useMemo(');b=s.index('  const feedLabel =',a);s=s[:a]+s[b:]
s=r(s,'              <span>Props</span>\n              <b>{groups.length.toLocaleString()}</b>','              <span>Players</span>\n              <b>{playerCards.length.toLocaleString()}</b>')
s=r(s,'\n                setInspector(null);\n','\n')
s=r(s,'                setSlipOpen(false);\n                setInspector(group);','                setSlipOpen(false);\n                router.push(playerResearchHref(group, undefined, book === ALL ? null : book));',2)
a=s.index('      {inspector ? (');b=s.index('      {slipOpen ? (',a);s=s[:a]+s[b:]
s=r(s,'  rows: PropGroup[];','  rows: PlayerCardGroup[];',2)
s=r(s,'<tr key={group.key} onClick={() => onInspect(group)}>','<tr key={group.playerCardKey} data-player-card={group.playerCardKey} onClick={() => onInspect(group)}>')
s=r(s,'<td className={styles.marketCell}>{group.market}</td>','<td className={styles.marketCell}>{group.market}<small className={styles.unavailable}> · {group.categoryCount} stats</small></td>')
s=r(s,'<td><ChevronRight size={16} className={styles.rowChevron} /></td>','<td><button type="button" aria-label={`Research ${group.player}`} onClick={(event) => { event.stopPropagation(); onInspect(group); }}><ChevronRight size={16} className={styles.rowChevron} /></button></td>')
s=r(s,'<article key={group.key} className={styles.mobileRow}>','<article key={group.playerCardKey} data-player-card={group.playerCardKey} className={styles.mobileRow}>')
s=r(s,'<small>{group.matchup}</small>','<small>{group.matchup} · {group.categoryCount} stats · {group.bookCount} books</small>')
s=r(s,'                Inspect\n','                Research\n')
a=s.index('function Inspector({');b=s.index('function SlipDrawer({',a);s=s[:a]+s[b:];p.write_text(s)
p=root/'apps/oblige-web/components/face-card.tsx';s=p.read_text()
s=r(s,"import { artworkUrl, fetchResearch, playedGames } from '@/lib/api';","import { fetchResearch, playedGames } from '@/lib/api';\nimport { PlayerHeadshot } from '@/components/player-headshot';")
a=s.index('  const [failed, setFailed] = React.useState(false);');b=s.index('\n/**\n * Combo markets',a)
s=s[:a]+'''  return (
    <span className={cn('ringavatar', className)} style={{ width: size, height: size }}>
      <span className="relative grid size-full place-items-center overflow-hidden rounded-full bg-[var(--face-surface-2)]">
        <PlayerHeadshot sport={sport} name={name} team={team} providerPlayerId={providerPlayerId}
          className="absolute inset-0 size-full object-cover object-top" />
      </span>
    </span>
  );
}
'''+s[b:];p.write_text(s)
p=root/'apps/oblige-web/components/prop-workspace.tsx';s=p.read_text()
s=r(s,"import {artworkUrl,fetchAccount} from '@/lib/api';","import {fetchAccount} from '@/lib/api';\nimport {PlayerHeadshot as VerifiedHeadshot} from '@/components/player-headshot';")
a=s.index('function PlayerHeadshot({player}');b=s.index('function researchHref(',a)
s=s[:a]+'''function PlayerHeadshot({player}:{player:WorkspacePlayer}){
 return <span className={styles.avatar}><VerifiedHeadshot sport={player.sport} name={player.name} providerPlayerId={player.playerId}/></span>;
}
'''+s[b:];p.write_text(s)
p=root/'apps/oblige-web/components/player-view.tsx';s=p.read_text()
s=r(s,"import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';","import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';\nimport { groupPlayerCards, playerMarketKey, playerCategories, quotedBooks, postedSelection, playerResearchHref } from '@/lib/player-cards';")
s=r(s,"  const lineParam = Number(params.get('line'));\n  const postedLine = Number.isFinite(lineParam) ? lineParam : null;","  const lineRaw = params.get('line');\n  const postedLine = lineRaw !== null && lineRaw.trim() !== '' && Number.isFinite(Number(lineRaw)) ? Number(lineRaw) : null;\n  const cardKey = params.get('card') || '';\n  const categoryKey = params.get('category') || '';\n  const selectedBook = params.get('book') || null;\n  const [resolvedCardKey, setResolvedCardKey] = React.useState(cardKey);")
s=r(s,'        const mine = board.groups.filter((candidate) => candidate.player === player);','''        if (controller.signal.aborted) return;
        const cards = groupPlayerCards(board.groups);
        const selected = cardKey ? cards.find(card => card.key === cardKey) : cards.find(card => card.variants.some(candidate => candidate.player === player));
        const mine = selected?.variants || [];
        setResolvedCardKey(selected?.key || cardKey);''')
s=r(s,'  }, [checking, account, sport, player]);','  }, [checking, account, sport, player, cardKey]);')
a=s.index('  const group = React.useMemo(');b=s.index('  const [state, setState]',a)
s=s[:a]+'''  const categories = React.useMemo(() => playerCategories(markets), [markets]);
  const group = React.useMemo(() => postedSelection(markets, categoryKey, selectedBook, postedLine, market), [markets, categoryKey, selectedBook, postedLine, market]);
  const categoryVariants = React.useMemo(() => group ? markets.filter(candidate => playerMarketKey(candidate) === playerMarketKey(group)) : [], [markets, group]);
  const allBooks = React.useMemo(() => quotedBooks(categoryVariants), [categoryVariants]);
  const postedLines = React.useMemo(() => [...new Set(categoryVariants.filter(candidate => !selectedBook || quotedBooks([candidate]).some(book => book.key === selectedBook.toLowerCase() || book.label === selectedBook)).map(candidate => candidate.line))].sort((a,b) => a-b), [categoryVariants, selectedBook]);
  const researchIdentity = group ? JSON.stringify([resolvedCardKey, playerMarketKey(group)]) : '';

'''+s[b:]
s=r(s,"    setState({ line: group.line, side: 'OVER', book: null });","    setState(previous => ({ line: group.line, side: previous.side, book: selectedBook }));")
s=r(s,'  }, [group?.key, group?.line]);','  }, [group?.key, group?.line, selectedBook]);')
s=r(s,'  }, [group?.key]);','  }, [researchIdentity]);')
a=s.index('  function selectMarket(');b=s.index('  function selectSection(',a)
s=s[:a]+'''  function choose(category: string, book: string | null, line: number | null) {
    const variants = markets.filter(candidate => playerMarketKey(candidate) === category);
    const next = postedSelection(variants, category, book, line);
    if (next) router.replace(playerResearchHref(next, resolvedCardKey, book), { scroll: false });
  }
  function selectCategory(category: string) {
    const variants = markets.filter(candidate => playerMarketKey(candidate) === category);
    const keepBook = selectedBook && quotedBooks(variants).some(book => book.key === selectedBook.toLowerCase() || book.label === selectedBook) ? selectedBook : null;
    choose(category, keepBook, postedLine);
  }

'''+s[b:]
a=s.index('          <span className="player-section-count">{markets.length}');b=s.index('\n      </section>',a)
s=s[:a]+'''          <span className="player-section-count">{categories.length} stat categories</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Player market choices">
          <label className="grid min-w-0 gap-1 text-sm">Stat category
            <select className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2" aria-label="Player stat category" value={playerMarketKey(group)} onChange={event => selectCategory(event.target.value)}>
              {categories.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm">Sportsbook
            <select className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2" aria-label="Selected book" value={selectedBook ? allBooks.find(book => book.key === selectedBook.toLowerCase() || book.label === selectedBook)?.key || '' : ''} onChange={event => choose(playerMarketKey(group), event.target.value || null, group.line)}>
              <option value="">Best prices · all books</option>
              {allBooks.map(book => <option key={book.key} value={book.key}>{book.label}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm">Posted line
            <select className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2" aria-label="Posted line or outcome" value={String(group.line)} onChange={event => choose(playerMarketKey(group), selectedBook, Number(event.target.value))}>
              {postedLines.map(line => <option key={line} value={String(line)}>{line}</option>)}
            </select>
          </label>
        </div>'''+s[b:]
s=r(s,'              group={group}\n              games={games}','              group={group}\n              hideBookFilter\n              games={games}')
p.write_text(s)
print('Applied bounded card grouping, exact-game research choices, and shared avatars. Existing board CSS unchanged.')
