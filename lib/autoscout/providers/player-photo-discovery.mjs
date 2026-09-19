/** Photo-only discovery. None of these aliases may be used for statistics,
 * markets, player-game history or provider polling. No arbitrary image URLs. */
import { normalizePlayerName } from '../../data-sources/contract.mjs';
import { samePublicTeam } from '../../data-sources/espn/identity.mjs';

const ALIASES = Object.freeze({
  FOOTBALL_NFL:'NFL', AMERICANFOOTBALL_NFL:'NFL', FOOTBALL_NCAAF:'NCAAF',
  AMERICANFOOTBALL_NCAAF:'NCAAF', BASKETBALL_NBA:'NBA', BASKETBALL_WNBA:'WNBA',
  BASKETBALL_NCAAB:'NCAAB', BASEBALL_MLB:'MLB', ICEHOCKEY_NHL:'NHL', HOCKEY_NHL:'NHL',
  CFB:'NCAAF', CBB:'NCAAB', NCAAM:'NCAAB', ATP:'TENNIS', WTA:'TENNIS', ITF:'TENNIS',
  PGA:'GOLF', LPGA:'GOLF', LIV:'GOLF', UFC:'MMA', CS:'COUNTER_STRIKE', CS2:'COUNTER_STRIKE',
  CSGO:'COUNTER_STRIKE', COUNTERSTRIKE:'COUNTER_STRIKE', LOL:'LEAGUE_OF_LEGENDS',
  DOTA2:'DOTA_2', ROCKETLEAGUE:'ROCKET_LEAGUE', TABLETENNIS:'TABLE_TENNIS',
});
export function photoSport(value) {
  let code=String(value||'').trim().toUpperCase().replace(/[- ]+/g,'_');
  code=code.replace(/^(NFL|NBA|WNBA|NHL|MLB|NCAAF|NCAAB)(?:LIVE|[1-4]H|[1-4]Q|Q[1-4]|H[12])$/,'$1');
  if(code.startsWith('SOCCER_'))return 'SOCCER';
  if(code.startsWith('TENNIS_'))return 'TENNIS';
  if(code.startsWith('GOLF_'))return 'GOLF';
  if(code.startsWith('MMA_'))return 'MMA';
  code=code.replace(/^ESPORTS?_/, '');
  return ALIASES[code]||code;
}
export function validPhotoSport(value) { return /^[A-Z][A-Z0-9_]{0,63}$/.test(photoSport(value)); }
const FAMILY = Object.freeze({NFL:'football',NCAAF:'football',NBA:'basketball',WNBA:'basketball',NCAAB:'basketball',MLB:'baseball',NHL:'hockey',MLS:'soccer',EPL:'soccer',UCL:'soccer',SOCCER:'soccer',TENNIS:'tennis',GOLF:'golf',MMA:'mma'});
const SPORTS = Object.freeze({
  NFL:['american football'],NCAAF:['american football'],NBA:['basketball'],WNBA:['basketball'],NCAAB:['basketball'],
  MLB:['baseball'],NHL:['ice hockey'],MLS:['association football'],EPL:['association football'],UCL:['association football'],SOCCER:['association football'],
  TENNIS:['tennis'],GOLF:['golf','golfer'],MMA:['mixed martial arts','mixed martial artist'],
  COUNTER_STRIKE:['counter strike','counter strike global offensive','counter strike 2'],
  LEAGUE_OF_LEGENDS:['league of legends'],DOTA_2:['dota 2'],ROCKET_LEAGUE:['rocket league'],
  VALORANT:['valorant'],TABLE_TENNIS:['table tennis'],F1:['formula one','formula 1'],
  NASCAR:['nascar'],CRICKET:['cricket','cricketer'],RUGBY:['rugby union','rugby league'],
});
const text=v=>String(v||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim().slice(0,2000);
const words=v=>String(v||'').toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
const claim=(entity,property)=>(entity?.claims?.[property]||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value).filter(v=>v!=null);
const ids=(entity,property)=>claim(entity,property).map(v=>v.id).filter(v=>/^Q\d+$/.test(v||''));
const names=entity=>[entity?.labels?.en?.value,...(entity?.aliases?.en||[]).map(a=>a.value),...claim(entity,'P1449').map(v=>v.text)].filter(Boolean);
const exactName=(entity,name)=>names(entity).some(v=>normalizePlayerName(v)===normalizePlayerName(name));
export function safeDiscoveredPhotoUrl(value) {
  try { const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    if(u.hostname==='upload.wikimedia.org'&&u.pathname.startsWith('/wikipedia/commons/'))return u.href;
    if(u.hostname==='a.espncdn.com'&&/^\/i\/headshots\/[a-z-]+\/players\/(?:full|headshot)\/[1-9]\d*\.(?:png|jpg)$/i.test(u.pathname))return u.href;
    if(u.hostname==='img.mlbstatic.com'&&/^\/mlb-photos\/image\/upload\/w_256,q_auto:good,f_auto\/v1\/people\/[1-9]\d*\/headshot\/67\/current$/.test(u.pathname))return u.href;
  } catch {}
  return null;
}
export function commonsLicense(info) {
  const m=info?.extmetadata||{},license=text(m.LicenseShortName?.value),creator=text(m.Artist?.value);
  let licenseUrl=text(m.LicenseUrl?.value);
  if(licenseUrl.startsWith('//'))licenseUrl='https:'+licenseUrl;
  let permitted=false;
  try { const u=new URL(licenseUrl);
    permitted=u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname==='creativecommons.org'&&/^\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:zero|mark)\/1\.0)\/?$/.test(u.pathname);
  } catch {}
  if(!permitted||!creator||!license||text(m.Restrictions?.value))return null;
  let sourceUrl;
  try { const u=new URL(info.descriptionurl);if(u.protocol!=='https:'||u.hostname!=='commons.wikimedia.org'||!u.pathname.startsWith('/wiki/File:')||u.username||u.password||u.port)return null;sourceUrl=u.href; } catch{return null;}
  return {creator,license,licenseUrl,sourceUrl,changes:'Resized thumbnail; no generated or substituted face.'};
}

/** Only a complete exact-name search, sport evidence and an unambiguous human
 * entity may supply a Commons image. Availability is not proof of identity. */
export function selectPhotoEntity(entities,related,{sport,name,team,explicitId}={}) {
  const expected=(SPORTS[photoSport(sport)]||[words(photoSport(sport))]).map(words);
  let matches=Object.values(entities||{}).filter(entity=> {
    if(!ids(entity,'P31').includes('Q5')||!exactName(entity,name))return false;
    const roles=[...ids(entity,'P641'),...ids(entity,'P106'),...ids(entity,'P2416')];
    return roles.some(id=>names(related[id]).some(label=>expected.some(s=>[s,s+' player',s+' athlete',s+' professional'].includes(words(label)))));
  });
  if(explicitId)matches=matches.filter(e=>e.id===explicitId);
  if(matches.length>1&&team)matches=matches.filter(entity=>ids(entity,'P54').some(id=>names(related[id]).some(label=>samePublicTeam(team,label,sport))));
  // Do not pick a namesake just because only one has a photograph.
  return matches.length===1?matches[0]:null;
}
const wdUrl=params=>'https://www.wikidata.org/w/api.php?'+new URLSearchParams({...params,format:'json'});
export function createPhotoDiscovery({json,imageBytes}) {
  async function espn(sport,name,context) {
    const family=FAMILY[sport];if(!family)return null;
    const payload=await json('https://site.web.api.espn.com/apis/search/v2?'+new URLSearchParams({query:normalizePlayerName(name),sport:family}));
    const groups=(payload?.results||[]).filter(g=>g.type==='player');
    const rawId=String(context.providerPlayerId||'');
    const explicit=/^espn:([1-9]\d*)$/i.exec(rawId)?.[1];
    const history=/^history:([^:]+):([1-9]\d*)$/i.exec(rawId);
    if(history&&photoSport(history[1])!==sport)return null;
    const wantedId=explicit||(history?.[2]);
    if(groups.some(g=>Number(g.totalFound)>(g.contents||[]).length)&&!wantedId)return null;
    const candidates=new Map();
    for(const row of groups.flatMap(g=>g.contents||[])) {
      if(row.sport!==family||normalizePlayerName(row.displayName)!==normalizePlayerName(name))continue;
      const id=/~a:([1-9]\d*)$/.exec(String(row.uid||''))?.[1];if(!id||wantedId&&wantedId!==id)continue;
      let link;try {link=new URL(row.link?.web);}catch{continue;}
      if(link.protocol!=='https:'||link.hostname!=='www.espn.com'||link.username||link.password||!link.pathname.startsWith('/'+family+'/')||!link.pathname.includes('/_/id/'+id+'/')&&!link.pathname.endsWith('/_/id/'+id))continue;
      // This supplement is for new sports. Team leagues continue to use the
      // original stricter league/roster resolver, never a cross-league match.
      if(!['soccer','tennis','golf','mma'].includes(family))continue;
      const url=safeDiscoveredPhotoUrl(row.image?.default);
      candidates.set(id,{id,row,url,sourceUrl:link.href});
    }
    let rows=[...candidates.values()];
    if(rows.length>1&&context.team)rows=rows.filter(({row})=>samePublicTeam(context.team,row.subtitle,sport));
    if(rows.length!==1)return null;
    const chosen=rows[0];
    if(!chosen.url||!new URL(chosen.url).pathname.endsWith('/'+chosen.id+'.png')&&!new URL(chosen.url).pathname.endsWith('/'+chosen.id+'.jpg'))return null;
    const {bytes,type}=await imageBytes(chosen.url);
    return {body:bytes,contentType:type,source:'ESPN',sourceUrl:chosen.sourceUrl,imageUrl:chosen.url,
      playerName:chosen.row.displayName,team:chosen.row.subtitle||null,providerPlayerId:`history:${sport}:${chosen.id}`,verified:true};
  }
  async function nativeMlb(sport,name,context) {
    const id=/^(?:mlb|mlbam):([1-9]\d*)$/i.exec(String(context.providerPlayerId||''))?.[1];
    if(sport!=='MLB'||!id)return null;
    const data=await json('https://statsapi.mlb.com/api/v1/people/'+id);
    const person=data?.people?.find(p=>String(p.id)===id&&normalizePlayerName(p.fullName)===normalizePlayerName(name));
    if(!person)return null;
    const imageUrl=`https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:good,f_auto/v1/people/${id}/headshot/67/current`;
    const {bytes,type}=await imageBytes(imageUrl);
    return {body:bytes,contentType:type,source:'MLB',sourceUrl:`https://www.mlb.com/player/${id}`,imageUrl,playerName:person.fullName,providerPlayerId:`mlb:${id}`,verified:true};
  }
  async function commons(sport,name,context) {
    const explicitId=/^wikidata:(Q[1-9]\d*)$/i.exec(String(context.providerPlayerId||''))?.[1]?.toUpperCase();
    let found;
    if(explicitId)found=[explicitId];
    else {
      const search=await json(wdUrl({action:'wbsearchentities',search:name,language:'en',uselang:'en',type:'item',limit:'10'}));
      if(search['search-continue']!==undefined)return null; // no first-page guessing
      found=(search.search||[]).map(r=>r.id).filter(id=>/^Q[1-9]\d*$/.test(id)).slice(0,10);
    }
    if(!found.length)return null;
    const result=await json(wdUrl({action:'wbgetentities',ids:found.join('|'),props:'labels|aliases|claims',languages:'en'}));
    const relatedIds=[...new Set(Object.values(result.entities||{}).flatMap(e=>[...ids(e,'P641'),...ids(e,'P106'),...ids(e,'P2416'),...ids(e,'P54')]))];
    if(!relatedIds.length||relatedIds.length>50)return null;
    const related=await json(wdUrl({action:'wbgetentities',ids:relatedIds.join('|'),props:'labels|aliases|claims',languages:'en'}));
    const entity=selectPhotoEntity(result.entities,related.entities||{},{sport,name,team:context.team,explicitId});
    if(!entity)return null;
    const filename=claim(entity,'P18').find(v=>typeof v==='string'&&v.length<=240);
    if(!filename)return null;
    const data=await json('https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',prop:'imageinfo',titles:'File:'+filename,iiprop:'url|mime|extmetadata',iiurlwidth:'256',iiextmetadatafilter:'Artist|LicenseShortName|LicenseUrl|Restrictions'}));
    const info=Object.values(data.query?.pages||{})[0]?.imageinfo?.[0];
    const credit=commonsLicense(info);const imageUrl=safeDiscoveredPhotoUrl(info?.thumburl||info?.url);
    if(!credit||!imageUrl||!['image/png','image/jpeg','image/webp'].includes(info.thumbmime||info.mime))return null;
    const {bytes,type}=await imageBytes(imageUrl);
    return {body:bytes,contentType:type,source:'Wikimedia Commons',...credit,imageUrl,
      identitySource:`https://www.wikidata.org/wiki/${entity.id}`,playerName:entity.labels?.en?.value||name,
      providerPlayerId:`wikidata:${entity.id}`,matchBasis:'unambiguous exact name and structured sport',verified:true};
  }
  return async function discover(sport,name,context={}) {
    sport=photoSport(sport);let failed=false;
    for(const resolve of [nativeMlb,espn,commons]) {
      try{const found=await resolve(sport,name,context);if(found)return found;}catch{failed=true;}
    }
    if(failed)throw new Error('Photo sources temporarily unavailable');
    return null;
  };
}

/** Credits come from persisted, verified source metadata, never HTML from a
 * remote artist field. This endpoint is linked from full player research. */
export function photoCreditPage(image) {
  const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link=(url,label)=> {
    try { const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.espn.com','www.mlb.com','www.wikidata.org','commons.wikimedia.org','creativecommons.org'].includes(u.hostname))return escape(label);return `<a href="${escape(u.href)}" rel="noopener noreferrer">${escape(label)}</a>`; }catch{return escape(label);}
  };
  const body=image.verified
    ? `<h1>${escape(image.playerName)} photo credit</h1><p>Source: ${link(image.sourceUrl,image.source)}</p>${image.creator?`<p>Creator: ${escape(image.creator)}</p>`:''}${image.license?`<p>Licence: ${link(image.licenseUrl,image.license)}</p>`:''}${image.identitySource?`<p>${link(image.identitySource,'Verified identity record')}</p>`:''}<p>${escape(image.changes||'Source-provided player photograph. No generated face or endorsement implied.')}</p>`
    : '<h1>Photo unavailable</h1><p>No verified photograph is currently saved for this player. A neutral placeholder is used, not another athlete or an invented face.</p>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ObligeProps photo credits</title><main>${body}</main></html>`;
}
