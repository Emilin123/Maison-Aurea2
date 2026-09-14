const BOT_TOKEN=process.env.BOT_TOKEN||'';
const APP_URL=(process.env.PUBLIC_APP_URL||'https://maison-aurea2-1.onrender.com').replace(/\/$/,'');
const SECRET=process.env.TELEGRAM_WEBHOOK_SECRET||'';
const CREATOR_ID=String(process.env.CREATOR_TELEGRAM_USER_ID||'7519855566');
async function call(method,payload){
  if(!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const j=await r.json();
  if(!j.ok) throw new Error(`${method}: ${j.description||'telegram_error'}`);
  return j.result;
}
const app=(screen)=>`${APP_URL}/app?screen=${encodeURIComponent(screen)}&v=20260913.18`;
const rows=[
  [{text:'⛏️ Minar',web_app:{url:app('mining')}},{text:'🃏 Carta jugadora del día',web_app:{url:app('cards')}}],
  [{text:'👛 Billetera',web_app:{url:app('wallet')}},{text:'🆘 Soporte',web_app:{url:app('support')}}],
  [{text:'💎 Tienda',web_app:{url:app('store')}},{text:'🤝 Referidos',web_app:{url:app('referrals')}}],
  [{text:'👑 Membresías',web_app:{url:app('members')}},{text:'⚡ Aceleradores',web_app:{url:app('accelerators')}}],
  [{text:'📋 Reglas',web_app:{url:app('rules')}},{text:'⚙️ Ajustes',web_app:{url:app('settings')}}],
  [{text:'🏠 Inicio',web_app:{url:app('home')}}]
];
try{
  await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Maison Aurea',web_app:{url:app('home')}}});
  const webhookPayload={url:`${APP_URL}/telegram/webhook`,allowed_updates:['message','callback_query']};
  if(SECRET) webhookPayload.secret_token=SECRET;
  await call('setWebhook',webhookPayload);
  await call('sendMessage',{chat_id:CREATOR_ID,text:'Maison Aurea · menú actualizado',reply_markup:{remove_keyboard:true}});
  await call('sendMessage',{chat_id:CREATOR_ID,text:'Selecciona una sección:',reply_markup:{keyboard:rows,resize_keyboard:true,is_persistent:true}});
  console.log('TELEGRAM MENU: HOME + FULL MENU CONFIGURED');
}catch(e){console.error('TELEGRAM MENU/WEBHOOK CONFIG FAILED:',e.message)}
