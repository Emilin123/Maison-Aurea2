const BOT_TOKEN=process.env.BOT_TOKEN||'';
const APP_URL=(process.env.PUBLIC_APP_URL||'https://maison-aurea2-1.onrender.com').replace(/\/$/,'');
const SECRET=process.env.TELEGRAM_WEBHOOK_SECRET||'';
async function call(method,payload){
  if(!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const j=await r.json();
  if(!j.ok) throw new Error(`${method}: ${j.description||'telegram_error'}`);
  return j.result;
}
try{
  await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Maison Aurea',web_app:{url:`${APP_URL}/app?screen=mining&v=20260913.1`}}});
  console.log('TELEGRAM MENU: WEB APP BUTTON CONFIGURED');
  const webhookPayload={url:`${APP_URL}/telegram/webhook`};
  if(SECRET) webhookPayload.secret_token=SECRET;
  await call('setWebhook',webhookPayload);
  console.log('TELEGRAM WEBHOOK: CONFIGURED');
}catch(e){console.error('TELEGRAM MENU/WEBHOOK CONFIG FAILED:',e.message)}
