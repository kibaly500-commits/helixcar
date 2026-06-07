export default async function handler(req, res) {
const { from, to } = req.query;
if (!from || !to) return res.status(400).json({ km: 0 });
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) return res.status(500).json({ km: 0 });
const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&mode=driving&units=metric&key=${apiKey}&language=fr`;
try {
const response = await fetch(url);
const data = await response.json();
if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
const km = Math.round(data.rows[0].elements[0].distance.value / 1000);
return res.status(200).json({ km });
}
return res.status(200).json({ km: 0 });
} catch (err) {
return res.status(200).json({ km: 0 });
}
}
