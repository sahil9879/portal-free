// Sends WhatsApp template messages through Meta's Cloud API.

export function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1); // Pakistan: 03xx -> 923xx
  return d.length >= 11 ? d : '';
}

export async function sendTemplate(to, template, params) {
  if (process.env.DRY_RUN !== 'false') {
    console.log(`[DRY RUN] ${to} <- ${template}`, params);
    return { ok: true, detail: 'dry run' };
  }
  const url = `https://graph.facebook.com/v20.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: process.env.WA_LANG || 'en' },
        components: [
          { type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '') })) },
        ],
      },
    }),
  });
  const body = await res.text();
  return { ok: res.ok, detail: body.slice(0, 300) };
}
