import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('./app_fixed.js',import.meta.url),'utf8');
const runtime='/tmp/maison-aurea-runtime.mjs';
await fs.writeFile(runtime,source+'\n}\nmain();\n','utf8');
await import(`file://${runtime}`);
