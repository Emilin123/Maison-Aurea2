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
  if(!BOT_TOKEN || !DATABASE_URL) return;
  const pool = new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try {
    const exists = await pool.query("select 1 from audit_log where action='telegram_delivery_probe_v1' limit 1");
    if(exists.rowCount) return;
    const stamp = new Date().toISOString();
    const msg = await telegram('sendMessage', {
      chat_id: CREATOR_ID,
      text: `🧪 PRUEBA DE NOTIFICACIONES — Maison Aurea\n\nHora: ${stamp}\n\nEsta notificación confirma que el servidor puede entregar mensajes Telegram al chat de la creadora.\n\nLos flujos de compra/retiro usarán este mismo transporte.`
    });
    await pool.query("insert into audit_log(actor_telegram_id,action,target_type,target_id,details) values($1,'telegram_delivery_probe_v1','system',$2,$3)",[CREATOR_ID,String(msg.message_id),JSON.stringify({sent_at:stamp})]);
    console.log('TELEGRAM DELIVERY PROBE: SENT', msg.message_id);
  } catch(e) {
    console.error('TELEGRAM DELIVERY PROBE: FAILED', e.message);
  } finally { await pool.end(); }
}
main();
