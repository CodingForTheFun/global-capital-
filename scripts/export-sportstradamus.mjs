/** Operator-only local publication. No credentials or model binaries cross the web API. */
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {buildSportstradamusSnapshot} from '../lib/ml/sportstradamus.mjs';
import {evaluateHeldout} from '../lib/ml/evaluate.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((out,v,i,a)=>i%2?out:[...out,[v.replace(/^--/,''),a[i+1]]],[]));
for(const key of ['offers','meta','board','model-files','output'])if(!args[key])throw Error('Usage: node scripts/export-sportstradamus.mjs --offers scored.json --meta meta.json --board board.json --model-files model-files.json --output data/ml/predictions.json');
const readJSON=async f=>{const b=await readFile(f);if(b.length>64_000_000)throw Error('Input too large.');return JSON.parse(b);};
const files=await readJSON(args['model-files']);if(!Array.isArray(files)||files.length>500)throw Error('Invalid model file list.');
const models=[];
for(const f of files){
 const base=path.dirname(path.resolve(args['model-files']));
 const evidence=await readFile(path.resolve(base,f.evidenceFile));if(evidence.length>64_000_000)throw Error('Evidence too large.');
 const m=evaluateHeldout(JSON.parse(evidence),{dataSha256:createHash('sha256').update(evidence).digest('hex')});
 if(!m.validation.passed)throw Error('Withheld model cannot be published: '+m.id);
 // Hash only. Never unpickle/import a model in the web-serving process.
 const actual=createHash('sha256').update(await readFile(path.resolve(base,f.artifactFile))).digest('hex');
 if(actual!==m.artifactSha256)throw Error('Model artifact does not match evaluation evidence: '+m.id);
 models.push(m);
}
const snapshot=buildSportstradamusSnapshot({scoredOffers:await readJSON(args.offers),metadata:await readJSON(args.meta),board:await readJSON(args.board),models});
const output=path.resolve(args.output);await mkdir(path.dirname(output),{recursive:true});
const tmp=output+'.'+randomUUID()+'.tmp';
try{await writeFile(tmp,JSON.stringify(snapshot)+'\n',{flag:'wx',mode:0o600});await rename(tmp,output);}finally{await rm(tmp,{force:true});}
console.log(JSON.stringify(snapshot.importReport));
