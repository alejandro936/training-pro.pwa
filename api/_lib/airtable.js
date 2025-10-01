// api/_lib/airtable.js
export async function atList({ baseId, table, params = {} }) {
  const PAT = process.env.AIRTABLE_PAT;
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function atGet({ baseId, table, id }) {
  const PAT = process.env.AIRTABLE_PAT;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${id}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  return r.json();
}
