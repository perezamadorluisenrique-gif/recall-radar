// NHTSA vehicle recalls. All endpoints allow browser requests (CORS), so this runs live.
const API = 'https://api.nhtsa.gov';

async function get(url) {
  const res = await fetch(url);
  // recallsByVehicle answers 400 with an empty list for unknown make/model combinations.
  if (!res.ok && res.status !== 400) throw new Error(`NHTSA ${res.status}`);
  return res.json();
}

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export async function decodeVin(vin) {
  const j = await get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
  const r = j.Results?.[0] || {};
  if (!r.Make || !r.ModelYear) throw new Error(r.ErrorText?.split(';')[0] || 'That VIN could not be decoded.');
  return { year: r.ModelYear, make: r.Make, model: r.Model, trim: r.Trim || '' };
}

export async function makesFor(year) {
  const j = await get(`${API}/products/vehicle/makes?modelYear=${year}&issueType=r`);
  return [...new Set((j.results || []).map((r) => r.make))].sort();
}

export async function modelsFor(year, make) {
  const j = await get(`${API}/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=r`);
  return [...new Set((j.results || []).map((r) => r.model))].sort();
}

// "27/09/2018" -> "2018-09-27"
export const nhtsaDate = (s = '') => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

export function toCampaign(r) {
  return {
    id: r.NHTSACampaignNumber,
    d: nhtsaDate(r.ReportReceivedDate),
    component: (r.Component || '').split(':').map((s) => s.trim().toLowerCase()).filter(Boolean).join(' › '),
    summary: r.Summary || '',
    consequence: r.Consequence || r.Conequence || '',
    remedy: r.Remedy || '',
    parkIt: !!r.parkIt,
    parkOutSide: !!r.parkOutSide,
    ota: !!r.overTheAirUpdate,
    maker: r.Manufacturer || '',
  };
}

export async function recallsFor({ year, make, model }) {
  const j = await get(`${API}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`);
  const seen = new Set();
  return (j.results || [])
    .map(toCampaign)
    .filter((c) => c.id && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => Number(b.parkIt || b.parkOutSide) - Number(a.parkIt || a.parkOutSide) || b.d.localeCompare(a.d));
}

export const campaignUrl = (id) => `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(id)}`;
export const vinCheckUrl = (vin) => `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin || '')}`;
