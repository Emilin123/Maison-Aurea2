import pg from 'pg';
const { Pool } = pg;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CREATOR_ID = String(process.env.CREATOR_TELEGRAM_USER_ID || '7519855566');
const DATABASE_URL = process.env.DATABASE_URL || '';

async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error('telegram_unavailable');
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'telegram_error');
  return j.result;
}

async function main(){
  if(!BOT_TOKEN || !DATABASE_URL) { console.error('TELEGRAM DELIVERY PROBE: FAILED missing BOT_TOKEN or DATABASE_URL'); return; }
  const pool = new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try {
    const stamp = new Date().toISOString();
    const msg = await telegram('sendMessage', {
      chat_id: CREATOR_ID,
      text: `🧪 PRUEBA REAL DE NOTIFICACIONES — Maison Aurea\n\nHora: ${stamp}\nChat de destino: creadora configurada en Render\n\nTelegram API aceptó este mensaje desde el servidor.\n\nEsta prueba usa las variables de producción y el mismo transporte que usarán compras y retiros.`
    });
    await pool.query("insert into audit_log(actor_telegram_id,action,target_type,target_id,details) values($1,'telegram_delivery_probe_v2','system',$2,$3)",[CREATOR_ID,String(msg.message_id),JSON.stringify({sent_at:stamp})]);
    console.log('TELEGRAM DELIVERY PROBE: SENT', msg.message_id);
  } catch(e) {
    console.error('TELEGRAM DELIVERY PROBE: FAILED', e.message);
  } finally { await pool.end(); }
}
main();
