// 가선영속눈썹연구소 — 문의 알림 (텔레그램 + 이메일 + 문자)
// 키는 Netlify 환경변수에만 있고 홈페이지 파일에는 들어가지 않습니다.

const crypto = require('crypto');

const {
  TELEGRAM_TOKEN, TELEGRAM_CHAT,
  SOLAPI_KEY, SOLAPI_SECRET, SMS_FROM,
  SHOP_NAME = '가선영속눈썹연구소',
  SHOP_TEL  = '010-4483-0550',
} = process.env;

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

/** 010-1234-5678 → 01012345678 */
const onlyDigits = (s) => String(s || '').replace(/[^0-9]/g, '');

async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return { ok: false, skipped: true };
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text }),
  });
  const j = await r.json();
  return { ok: !!j.ok, error: j.description };
}

async function sendSMS(to, text) {
  if (!SOLAPI_KEY || !SOLAPI_SECRET || !SMS_FROM) return { ok: false, skipped: true };
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', SOLAPI_SECRET).update(date + salt).digest('hex');

  const r = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({
      message: { to: onlyDigits(to), from: onlyDigits(SMS_FROM), text },
    }),
  });
  const j = await r.json();
  return { ok: r.ok && !j.errorCode, error: j.errorMessage || j.errorCode };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  let d;
  try { d = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'bad json' }); }

  const name = String(d.name || '').trim().slice(0, 40);
  const tel  = String(d.tel  || '').trim().slice(0, 20);
  const type = String(d.type || '').trim().slice(0, 40);
  const msg  = String(d.msg  || '').trim().slice(0, 1000);
  if (!name || !tel) return json(400, { ok: false, error: '이름과 연락처는 필수입니다.' });

  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const p = (n) => String(n).padStart(2, '0');
  const when = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;

  const ownerText =
    `🔔 새 문의가 들어왔습니다\n\n` +
    `문의 유형 : ${type}\n이름 : ${name}\n연락처 : ${tel}\n내용 : ${msg || '(없음)'}\n\n` +
    `${when}\n${SHOP_NAME} 홈페이지`;

  // 손님에게 나가는 안내 문자 (90byte 이내로 짧게 → SMS 요금 적용)
  const guestText =
    `[${SHOP_NAME}]\n문의가 정상 접수되었습니다.\n확인 후 순차적으로 연락드리겠습니다.\n문의 ${SHOP_TEL}`;

  const [owner, guest] = await Promise.all([
    sendTelegram(ownerText).catch((e) => ({ ok: false, error: e.message })),
    sendSMS(tel, guestText).catch((e) => ({ ok: false, error: e.message })),
  ]);

  return json(200, { ok: owner.ok || guest.ok, owner, guest });
};
