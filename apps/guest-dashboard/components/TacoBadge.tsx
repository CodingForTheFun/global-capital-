'use client';
import {useEffect,useState} from 'react';
import {verifiedTaco} from '../../../lib/ui/offer-promotion.mjs';
export default function TacoBadge({quote}:{quote:unknown}) {
  const [now,setNow]=useState(Date.now);
  const promotion=verifiedTaco(quote,Math.max(now,Date.now()));
  const until=promotion?.validUntil;
  useEffect(()=>{
    if(!until)return;
    const update=()=>setNow(Date.now());
    const timer=setTimeout(update,Math.max(0,until-Date.now())+1);
    document.addEventListener('visibilitychange',update);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',update);};
  },[until]);
  return promotion ? <span className="asTacoBadge" data-taco-offer={promotion.offerId} role="img" aria-label="Verified PrizePicks Taco offer" title="PrizePicks Taco: this exact promotional line only">🌮</span> : null;
}
