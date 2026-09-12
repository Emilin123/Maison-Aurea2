import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const target='/app/maison-aurea-final';
if(!fs.existsSync(target+'/server.js')){
  const b64=fs.readFileSync('/app/bundle.b64','utf8');
  fs.writeFileSync('/tmp/maison-aurea.tar.gz',Buffer.from(b64,'base64'));
  execFileSync('tar',['-xzf','/tmp/maison-aurea.tar.gz','-C','/app']);
}
await import('/app/maison-aurea-final/server.js');
