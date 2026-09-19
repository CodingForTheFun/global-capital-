'use client';
import * as React from 'react';
import { headshotSources, unavailablePhoto, type HeadshotIdentity } from '@/lib/player-headshots';

type Props = HeadshotIdentity & { className?: string };

/** Returns the same single img element as the previous cards: no new layout. */
export function PlayerHeadshot(props: Props) {
  const identity = JSON.stringify([props.sport, props.name, props.team || '', props.providerPlayerId || '']);
  return <HeadshotImage key={identity} {...props} />;
}

function HeadshotImage({ className, ...identity }: Props) {
  const sources = React.useMemo(() => headshotSources(identity), [identity.sport, identity.name, identity.team, identity.providerPlayerId]);
  const [index, setIndex] = React.useState(0);
  const src = sources[Math.min(index, sources.length - 1)];
  const fallback = src === unavailablePhoto;
  return (
    // Sources are already same-origin URLs: the public CDN candidate uses the
    // restricted optimizer; the verified artwork route keeps its own cookies.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={fallback ? `${identity.name}: photo unavailable` : `${identity.name} headshot`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-player-photo={fallback ? 'unavailable' : 'candidate'}
      onError={(event) => {
        if (event.currentTarget.getAttribute('src') !== src || fallback) return;
        setIndex(current => current === index ? Math.min(current + 1, sources.length - 1) : current);
      }}
    />
  );
}
