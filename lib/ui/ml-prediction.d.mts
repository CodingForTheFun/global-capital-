export type MLTarget = {sport:string;eventId:string;playerId:string;playerName:string;marketId:string;sportsbookKey:string;gameStartTime:string;line:number;entityType?:string;live?:boolean;isAlternate?:boolean};
export type MLResult = {available:boolean;code:string;message?:string;[key:string]:unknown};
export function predictionKey(input:unknown):string|null;
export function predictionHtml(result:MLResult|null,side?:string):string;
export function createMLClient():{lookup(input:MLTarget):Promise<MLResult>;peek(input:MLTarget):MLResult|null};
