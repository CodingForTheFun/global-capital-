// Deliver already-tested static assets to the NEW standalone Netlify site.
// A short-lived capability is received only as RSA-OAEP + AES-256-GCM ciphertext.
// No plaintext capability, symmetric key or private key enters Git or artifacts.
import {privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {readFile,writeFile,rm,mkdir,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const siteId='3ff40dca-bb87-481b-829b-1141dfcb6b49';
const branch='standalone/edge-sports-20260912';
const repo='CodingForTheFun/global-capital-';
const runId=process.env.GITHUB_RUN_ID;
if(process.env.GITHUB_REPOSITORY!==repo||process.env.GITHUB_REF!==`refs/heads/${branch}`)throw new Error('Wrong deployment target');
const privatePath=path.join(process.env.RUNNER_TEMP,'edge-deploy-private.pem');
const privateKey=await readFile(privatePath,'utf8');
let capability=null;
try{
 for(let i=0;i<100;i++){
  const url=`https://api.github.com/repos/${repo}/contents/.deployment/run-${runId}.json?ref=${encodeURIComponent(branch)}`;
  const response=await fetch(url,{headers:{authorization:`Bearer ${process.env.READ_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
  if(response.ok){const file=await response.json();const envelope=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));if(envelope.runId!==runId)throw new Error('Wrong recipient');
   const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
   const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));cipher.setAAD(Buffer.from(`${runId}:${siteId}`));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
   const plain=Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]);key.fill(0);const message=JSON.parse(plain.toString('utf8'));plain.fill(0);
   if(message.siteId!==siteId||message.runId!==runId||message.sha!==process.env.GITHUB_SHA||Date.now()>message.expiresAt)throw new Error('Invalid or expired deployment authorization');
   const parsed=new URL(message.proxyPath);if(parsed.origin!=='https://netlify-mcp.netlify.app'||!parsed.pathname.startsWith('/proxy/')||parsed.search||parsed.hash)throw new Error('Unexpected deployment service');
   capability=message.proxyPath;break;
  }
  if(response.status!==404&&!response.ok)throw new Error(`Handoff read failed ${response.status}`);
  await new Promise(r=>setTimeout(r,6000));
 }
 if(!capability)throw new Error('Timed out waiting for the scoped deployment authorization');
 // Redact both URL and bearer-capability segment before any child output.
 console.log(`::add-mask::${capability}`);console.log(`::add-mask::${new URL(capability).pathname.slice('/proxy/'.length)}`);
 const ship=path.join(process.env.RUNNER_TEMP,'edge-netlify-static');await mkdir(ship,{recursive:true});await cp('frontend/dist',ship,{recursive:true});
 await writeFile(path.join(ship,'netlify.toml'),'[build]\n  command = "echo Prebuilt static dashboard"\n  publish = "."\n');
 let output='';const code=await new Promise((resolve,reject)=>{const child=spawn('npx',['-y','@netlify/mcp@latest','--site-id',siteId,'--proxy-path',capability],{cwd:ship,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.RUNNER_TEMP,CI:'true',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  const collect=c=>{output+=c.toString();if(output.length>200000)output=output.slice(-200000);};child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',()=>reject(new Error('Netlify deployment command could not start')));child.on('exit',resolve);setTimeout(()=>child.kill('SIGTERM'),8*60*1000).unref();});
 const safe=output.replaceAll(capability,'[SCOPED_DEPLOYMENT_AUTHORIZATION]').replaceAll(new URL(capability).pathname.slice('/proxy/'.length),'[REDACTED]');console.log(safe);
 await writeFile('artifacts/netlify-deployment.txt',safe);if(code!==0)throw new Error('Netlify deployment command did not complete successfully');
 console.log('NETLIFY_UPLOAD_COMPLETE site=edge-standalone-ty');
}finally{capability=null;await rm(privatePath,{force:true});}
