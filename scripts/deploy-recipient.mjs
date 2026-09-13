// One-time recipient key for an authorized, site-scoped Netlify deployment.
// The private key stays in this ephemeral CI runner; only the public key is
// uploaded. Never commit a plaintext deploy capability or private key.
import {generateKeyPairSync} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
if(process.env.GITHUB_REPOSITORY!=='CodingForTheFun/global-capital-'||process.env.GITHUB_REF!=='refs/heads/standalone/edge-sports-20260912')throw new Error('Wrong deployment repository or branch');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
await mkdir('deploy-public',{recursive:true});
await writeFile(path.join(process.env.RUNNER_TEMP,'edge-deploy-private.pem'),privateKey,{mode:0o600});
await writeFile('deploy-public/recipient.json',JSON.stringify({runId:process.env.GITHUB_RUN_ID,sha:process.env.GITHUB_SHA,siteId:'3ff40dca-bb87-481b-829b-1141dfcb6b49',publicKey},null,2));
console.log('Ephemeral public deployment recipient created; private key remains only on this runner.');
