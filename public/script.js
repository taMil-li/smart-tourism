// Signout utility for public pages (if needed)
function signOutUser() {
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }
  const jwt = getCookie('jwt');
  if (!jwt) {
    window.location.href = '../authenticate/login.html';
    return;
  }
  fetch('https://smart-tourism-backend-2.onrender.com/api/signout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': jwt
    },
    body: JSON.stringify({ user_data_hash: '', govt_signout_signature: '' })
  }).finally(() => {
    document.cookie = 'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '../authenticate/login.html';
  });
}
/* ========== Utilities ========== */
const $ = s => document.querySelector(s);
const setStatus = (id, text, cls='muted') => { const el=document.getElementById(id); el.textContent=text; el.className='pill '+cls; };
const fmt = (v, d='—') => (v===undefined || v===null || v==='')?d:v;
const R = 6371;
function haversineKm(lat1,lon1,lat2,lon2){
  const dLat=(lat2-lat1)*Math.PI/180; const dLon=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ========== Global state ========== */
let LAST = { lat:null, lon:null, address:null, city:null, country:null };
let watchId = null;
let map = null, userMarker = null, clusterLayer = null, heatLayer = null;
let markers = []; // store L.marker
const CRIME_RADIUS_KM = 10; // 10 km radius display

/* ========== Map init ========== */
function initMap() {
  map = L.map('map', { zoomControl:true }).setView([20.5937,78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  clusterLayer = L.markerClusterGroup();
  map.addLayer(clusterLayer);
  heatLayer = L.layerGroup().addTo(map);
}
initMap();

// Redirect to signup and login pages
document.getElementById('signup').addEventListener('click', function() {
  window.location.href = '../authenticate/signup.html';
});
document.getElementById('login').addEventListener('click', function() {
  window.location.href = '../authenticate/login.html';
});

/* ========== tiny UI helpers ========== */
function showTableCrimes(crimes) {
  // crimes: array of objects {type,date,desc,lat,lon,source}
  const container = $('#crimeContent');
  if(!crimes || !crimes.length) { container.innerHTML = '<div class="small muted">No recent crimes found.</div>'; return; }
  // create table
  let html = `<table class="crime-table"><thead><tr><th>Date</th><th>Type</th><th>Location</th><th>Source</th></tr></thead><tbody>`;
  for(const c of crimes.slice(0,200)){
    html += `<tr><td class="mono small">${fmt(c.date)}</td><td>${c.type||'—'}</td><td>${c.place|| (c.lat?`${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`:'—')}</td><td><a href="${c.source||'#'}" target="_blank">link</a></td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function showMapCrimes(crimes) {
  // remove old markers and heat
  clusterLayer.clearLayers(); heatLayer.clearLayers(); markers = [];
  if(!crimes || crimes.length === 0) {
    $('#crimeContent').innerHTML = '<div class="small muted">No nearby incidents.</div>';
    return;
  }
  $('#crimeContent').innerHTML = ''; // keep map as main view
  const heatPoints = [];
  for(const c of crimes) {
    if(!c.lat || !c.lon) continue;
    // small red circle marker (5-10px)
    const dot = L.circleMarker([c.lat,c.lon], {
      radius: 6,
      color: '#ff3b3b',
      weight: 1,
      fillColor: '#ff3b3b',
      fillOpacity: 0.9
    });
    // popup content
    const popupHtml = `<div style="max-width:260px;">
      <strong>${c.type||'Crime'}</strong><br/>
      <small class="mono">${fmt(c.date)}</small><br/>
      ${c.desc? `<div style="margin-top:6px;">${c.desc}</div>`:''}
      ${c.source?`<div style="margin-top:6px;"><a target="_blank" href="${c.source}">source</a></div>`:''}
    </div>`;
    dot.bindPopup(popupHtml);
    // mini label (always visible small text) - use DivIcon anchored slightly above right
    const mini = L.divIcon({ className:'crime-mini', html: `<div title="${c.type||''}">${(c.type||'').slice(0,20)}</div>`, iconSize: [1,1], popupAnchor:[0,-6]});
    const miniMarker = L.marker([c.lat, c.lon], { icon: mini, interactive: false, zIndexOffset:1000 });
    // add to cluster & heat
    clusterLayer.addLayer(dot);
    clusterLayer.addLayer(miniMarker);
    heatPoints.push([c.lat, c.lon, 0.5]);
    markers.push(dot);
  }
  if(heatPoints.length) {
    const heat = L.heatLayer(heatPoints, { radius: 25, blur: 30, maxZoom: 15 });
    heatLayer.addLayer(heat);
  }
}

/* ========== Place "You are here" marker ========== */
function setUserMarker(lat,lon) {
  if(userMarker) map.removeLayer(userMarker);
  userMarker = L.marker([lat,lon], { title: "You are here", riseOnHover:true }).addTo(map).bindPopup("<b>You are here</b>").openPopup();
  map.setView([lat,lon], 14);
}

/* ========== Reverse geocode (Nominatim) ========== */
async function reverseGeocode(lat,lon) {
  setStatus('addrStatus','loading…');
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const r = await fetch(url, { headers:{ 'Accept':'application/json' }});
  if(!r.ok) throw new Error('Nominatim failed');
  const json = await r.json();
  $('#address').textContent = json.display_name || 'Unknown';
  const a = json.address || {};
  $('#admin').textContent = [a.suburb, a.city || a.town || a.village || a.hamlet, a.state, a.postcode, a.country].filter(Boolean).join(' • ');
  LAST.city = a.city || a.town || a.village || a.hamlet || null;
  LAST.country = a.country || null;
  LAST.address = json.display_name || null;
  setStatus('addrStatus','ok','ok');
}

/* ========== Weather (Open-Meteo) ========== */
function getWeather(weatherCode, isDay) {
  const isDaytime = Boolean(isDay);

  const weatherDescriptions = {
    0: isDaytime ? "Sunny" : "Clear Night",
    1: isDaytime ? "Mostly Sunny" : "Mostly Clear Night",
    2: isDaytime ? "Partly Cloudy" : "Partly Cloudy Night",
    3: "Overcast",
    45: "Foggy",
    48: "Foggy (with frost)",
    51: "Light Drizzle",
    53: "Moderate Drizzle",
    55: "Heavy Drizzle",
    56: "Freezing Drizzle",
    57: "Heavy Freezing Drizzle",
    61: "Light Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    66: "Freezing Rain",
    67: "Heavy Freezing Rain",
    71: "Light Snow",
    73: "Moderate Snow",
    75: "Heavy Snow",
    77: "Snow Grains",
    80: "Light Rain Showers",
    81: "Moderate Rain Showers",
    82: "Violent Rain Showers",
    85: "Light Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "Thunderstorm with Hail",
    99: "Severe Thunderstorm with Hail"
  };

  return weatherDescriptions[weatherCode] || "Unknown Weather";
}

async function fetchWeather(lat,lon) {
  setStatus('wxStatus','loading…');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('Open-Meteo failed');
  const j = await r.json();
  const c = j.current_weather || {};
  $('#temp').textContent = fmt(c.temperature);
  $('#wind').textContent = fmt(c.windspeed);
  $('#wcode').textContent = fmt(getWeather(c.weathercode, c.is_day));
  $('#wtime').textContent = fmt(c.time);
  setStatus('wxStatus','ok','ok');
}

/* ========== Overpass POIs: police/hospital/fire/military ========== */
async function overpassQuery(q) {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method:'POST', headers: { 'Content-Type':'text/plain;charset=UTF-8' }, body: q
  });
  if(!r.ok) throw new Error('Overpass failed');
  return r.json();
}
async function fetchPOIs(lat,lon,radius=5000) {
  radius = Math.min(Math.max(radius,1000),10000);
  // police
  setStatus('polStatus','loading…');
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=police](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList('policeList', j.elements, lat,lon, 'Police Station');
    setStatus('polStatus','ok','ok');
  } catch(e){ setStatus('polStatus','error','bad'); $('#policeList').innerHTML=`<li class="error">${e.message}</li>`; }
  // hospital
  setStatus('hospStatus','loading…');
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=hospital](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList('hospList', j.elements, lat,lon, 'Hospital');
    setStatus('hospStatus','ok','ok');
  } catch(e){ setStatus('hospStatus','error','bad'); $('#hospList').innerHTML=`<li class="error">${e.message}</li>`; }
  // fire
  setStatus('fireStatus','loading…');
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=fire_station](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList('fireList', j.elements, lat,lon, 'Fire Station');
    setStatus('fireStatus','ok','ok');
  } catch(e){ setStatus('fireStatus','error','bad'); $('#fireList').innerHTML=`<li class="error">${e.message}</li>`; }
  // military
  setStatus('milStatus','loading…');
  try {
    const q = `[out:json][timeout:30];
      ( nwr[landuse=military](around:${radius},${lat},${lon});
        nwr[military](around:${radius},${lat},${lon});
        nwr[barrier=border_control](around:${radius},${lat},${lon});
      );
      out center 40;`;
    const j = await overpassQuery(q);
    renderPOIList('milList', j.elements, lat,lon, 'Restricted Area');
    setStatus('milStatus','ok','ok');
  } catch(e){ setStatus('milStatus','error','bad'); $('#milList').innerHTML=`<li class="error">${e.message}</li>`; }
}
function renderPOIList(containerId, elements, lat,lon, fallback) {
  const ul = document.getElementById(containerId);
  if(!elements || !elements.length) { ul.innerHTML = '<li class="muted">None found in radius.</li>'; return; }
  const out = elements.map(el => {
    const n = (el.tags && (el.tags.name || el.tags['name:en'])) || fallback;
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    const d = (elat && elon)? haversineKm(lat,lon,elat,elon).toFixed(2) : null;
    const maplink = (elat && elon)? `https://www.openstreetmap.org/?mlat=${elat}&mlon=${elon}#map=17/${elat}/${elon}` : '#';
    return `<li>${n}${d?` • <span class="mono small">${d} km</span>`:''} • <a href="${maplink}" target="_blank">map</a></li>`;
  });
  ul.innerHTML = out.join('');
}

/* ========== GDACS (RSS) with CORS fallback ========== */
async function fetchGDACS(lat,lon,withinKm=800) {
  setStatus('gdacsStatus','loading…');
  async function tfetch(url){ const r = await fetch(url); if(!r.ok) throw new Error('fetch failure'); return r.text(); }
  let xml;
  try { xml = await tfetch('https://www.gdacs.org/rss.aspx'); }
  catch { xml = await tfetch('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.gdacs.org/rss.aspx')); }
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [...doc.getElementsByTagName('item')];
  const list = [];
  for(const it of items.slice(0,40)) {
    const title = it.getElementsByTagName('title')[0]?.textContent || 'Alert';
    const link = it.getElementsByTagName('link')[0]?.textContent || '#';
    const latN = parseFloat(it.getElementsByTagName('geo:lat')[0]?.textContent || 'NaN');
    const lonN = parseFloat(it.getElementsByTagName('geo:long')[0]?.textContent || 'NaN');
    if(!Number.isNaN(latN) && !Number.isNaN(lonN)) {
      const d = haversineKm(lat,lon,latN,lonN);
      if(d <= withinKm) list.push(`<li><a target="_blank" href="${link}">${title}</a> • <span class="mono small">${Math.round(d)} km</span></li>`);
    }
  }
  $('#gdacsList').innerHTML = list.length ? list.join('') : '<li class="muted">No nearby GDACS alerts.</li>';
  setStatus('gdacsStatus','ok','ok');
}

/* ========== ReliefWeb security/terrorism feed ========== */
async function fetchRelief(countryHint=null,limit=8) {
  setStatus('reliefStatus','loading…');
  const query = encodeURIComponent(countryHint ? `security OR terrorism ${countryHint}` : 'security OR terrorism');
  const url = `https://api.reliefweb.int/v1/reports?appname=free-safety-app&query[value]=${query}&limit=${limit}&profile=full`;
  try {
    const r = await fetch(url);
    if(!r.ok) throw new Error('ReliefWeb fetch failed');
    const j = await r.json();
    const lines = (j.data||[]).map(item => {
      const t = item.fields?.title || 'Report';
      const l = item.fields?.url || '#';
      const s = item.fields?.source?.map(x=>x.shortname||x.name).join(', ');
      const d = item.fields?.date?.original || '';
      return `<li><a target="_blank" href="${l}">${t}</a> • <span class="small muted">${s}</span> • <span class="mono small">${d.slice(0,10)}</span></li>`;
    });
    $('#reliefList').innerHTML = lines.length ? lines.join('') : '<li class="muted">No recent reports found.</li>';
    setStatus('reliefStatus','ok','ok');
  } catch(e) {
     $('#reliefList').innerHTML = `<li class="muted">No Recent Security/Terrorism reports found</li>`; 
     console.log(e.message); 
     setStatus('reliefStatus','error','bad'); 
  }
}

/* ========== Crime data fetchers per region ========== */
/* This function attempts to get incident-level crime points (lat/lon) from several free sources.
   - If in USA and city matches Chicago/Los Angeles/New York: use Socrata endpoints (no key required for public datasets)
   - If other US city: try SpotCrime (feed) or Crimeometer (requires key; optional)
   - If India (Chennai/Delhi): try data.gov.in or state portal datasets — many India datasets are aggregated; if only aggregated, show table.
   - Otherwise, attempt SpotCrime or return empty.
*/

/* ---------- Chicago ---------- */
async function fetchChicagoCrimes(lat,lon,km=10) {
  // Socrata endpoint for Crimes - 2001 to Present (city of Chicago)
  // Use within_circle(location, lat, lon, meters)
  const meters = Math.round(km*1000);
  const endpoint = `https://data.cityofchicago.org/resource/ijzp-q8t2.json?$limit=1000&$where=within_circle(location, ${lat}, ${lon}, ${meters})&$order=crime_date DESC`;
  try {
    const r = await fetch(endpoint);
    if(!r.ok) throw new Error('Chicago API error');
    const d = await r.json(); // array
    // normalize to our crime object
    return d.map(item => ({
      type: item.primary_type || item.description || 'Crime',
      date: item.date || item.crime_date || '',
      desc: item.description || '',
      lat: item.location && item.location.coordinates ? item.location.coordinates[1] : (item.latitude?parseFloat(item.latitude):null),
      lon: item.location && item.location.coordinates ? item.location.coordinates[0] : (item.longitude?parseFloat(item.longitude):null),
      source: 'https://data.cityofchicago.org'
    })).filter(x => x.lat && x.lon);
  } catch(e){ console.warn('Chicago fetch fail',e); return []; }
}

/* ---------- Los Angeles ---------- */
async function fetchLACrimes(lat,lon,km=10) {
  const meters = Math.round(km*1000);
  // LA's dataset uses field 'location_1' with coordinates; Socrata style endpoint:
  const endpoint = `https://data.lacity.org/resource/2nrs-mtv8.json?$limit=1000&$where=within_circle(location_1, ${lat}, ${lon}, ${meters})&$order=dr_no DESC`;
  try {
    const r = await fetch(endpoint);
    if(!r.ok) throw new Error('LA API error');
    const d = await r.json();
    return d.map(item => ({
      type: item.crm_cde || item.participating_officer || 'Crime',
      date: item.date_occ || item.report_date || '',
      desc: item.location_description || item.crime || '',
      lat: item.location_1 && item.location_1.coordinates ? parseFloat(item.location_1.coordinates[1]) : (item.latitude?parseFloat(item.latitude):null),
      lon: item.location_1 && item.location_1.coordinates ? parseFloat(item.location_1.coordinates[0]) : (item.longitude?parseFloat(item.longitude):null),
      source: 'https://data.lacity.org'
    })).filter(x => x.lat && x.lon);
  } catch(e){ console.warn('LA fetch fail',e); return []; }
}

/* ---------- New York (NYPD) ---------- */
async function fetchNYCrimes(lat,lon,km=10) {
  // NYPD dataset endpoint on Socrata (example)
  // Example SOC endpoint - modify field names if needed; this is a best-effort
  const meters = Math.round(km*1000);
  const endpoint = `https://data.cityofnewyork.us/resource/qgea-i56i.json?$limit=1000&$where=within_circle(geom, ${lat}, ${lon}, ${meters})&$order=cmplnt_fr_dt DESC`;
  try {
    const r = await fetch(endpoint);
    if(!r.ok) throw new Error('NY API error');
    const d = await r.json();
    return d.map(item => ({
      type: item.kcd || item.offense_description || 'Crime',
      date: item.cmplnt_fr_dt || item.rpt_dt || '',
      desc: item.ofns_desc || item.boro_nm || '',
      lat: item.latitude?parseFloat(item.latitude):null,
      lon: item.longitude?parseFloat(item.longitude):null,
      source: 'https://data.cityofnewyork.us'
    })).filter(x => x.lat && x.lon);
  } catch(e){ console.warn('NY fetch fail',e); return []; }
}

/* ---------- SpotCrime (optional) - some cities provide RSS/JSON ----
   Many SpotCrime endpoints are region-specific. We'll attempt to call their public feeds if available.
   If not, this remains optional fallback.
*/
async function fetchSpotCrime(lat,lon,km=10) {
  // SpotCrime has region-based feeds; this is left as a generic fallback; often requires city param.
  // We'll attempt to use a simple API pattern; but if CORS prevents it, it's optional.
  return [];
}

/* ---------- Data.gov.in / India aggregated datasets ----------
   For India we will attempt to call data.gov.in resources:
   - "Crime in India - 2022" and district-level datasets are aggregated.
   - For Chennai/Delhi: check state portals (Tamil Nadu / Delhi open data) for incident lists; many are not point-level.
   Implementation: request known APIs/resources (if they expose JSON) and convert to table rows.
   If incident lat/lon missing, display table.
*/
async function fetchIndiaCrimes(lat,lon,cityName) {
  // Best-effort approach:
  // 1) Try Chennai specific portal (tn.data.gov.in) for crime/accident resources => some have CSVs.
  // 2) Try Delhi open data portal group (delhi.data.gov.in) for any incident feeds.
  // 3) If not, return an empty set or aggregated table data pulled from data.gov.in catalog.
  // NOTE: Many India datasets are aggregated; we'll show them in the table if no point-level data available.
  // For this demo we return empty point-level and fetch aggregated sample from data.gov.in for the city/state.
  try {
    // Example: get Crime in India catalog (aggregated) - we use it for table display
    const catalogUrl = 'https://data.gov.in/api/datastore/resource/search.json?resource_id=7b9b6b2b-1c3a-4b0b-829d-0d5b5f7c4f28&limit=5';
    // NOTE: the exact resource_id varies across datasets; this is a placeholder demonstration call.
    // We'll attempt no heavy reliance; instead we return [] points and indicate aggregated fallback.
    return { points: [], aggregated: true };
  } catch(e) {
    return { points: [], aggregated: true };
  }
}

/* ========== Orchestrator: gather crimelist from sources based on place ========== */
async function gatherCrimePoints(lat,lon,km=10) {
  setStatus('crimeStatus','loading…');
  const lowerCity = (LAST.city||'').toLowerCase();
  const lowerCountry = (LAST.country||'').toLowerCase();
  const results = [];
  try {
    if(lowerCountry.includes('united states') || lowerCountry === 'usa' || lowerCountry==='united states of america') {
      // route by city heuristics
      if(lowerCity.includes('chicago')) {
        const c = await fetchChicagoCrimes(lat,lon,km); results.push(...c);
      } else if(lowerCity.includes('los angeles') || lowerCity.includes('l.a.') || lowerCity.includes('la')) {
        const c = await fetchLACrimes(lat,lon,km); results.push(...c);
      } else if(lowerCity.includes('new york') || lowerCity.includes('manhattan') || lowerCity.includes('nyc')) {
        const c = await fetchNYCrimes(lat,lon,km); results.push(...c);
      } else {
        // generic: attempt SpotCrime or leave empty
        const c = await fetchSpotCrime(lat,lon,km);
        results.push(...c);
      }
    } else if(lowerCountry.includes('india') || lowerCountry.includes('india')) {
      // India: many open datasets are aggregated. Try to fetch point-level from state portals, else return aggregated for table.
      const out = await fetchIndiaCrimes(lat,lon, LAST.city);
      if(out.points && out.points.length) results.push(...out.points);
      else {
        // aggregated fallback: create a short table from data.gov.in summary (demo)
        setStatus('crimeStatus','table','warn');
        // produce a dummy aggregated table or real aggregated fetch: we will show message and supply aggregated examples
        $('#crimeContent').innerHTML = `<div class="small muted">Detailed incident-level data not available publicly for this area via free endpoints. Displaying aggregated crime statistics instead (district/state-level). You can plug your city police's incident JSON to show map points.</div>`;
        setStatus('crimeStatus','ok','ok');
        return { points: [], aggregated:true };
      }
    } else if(lowerCountry.includes('united kingdom') || lowerCity.includes('london')) {
      // London: generally aggregated; try London Datastore — here we'll return aggregated
      setStatus('crimeStatus','table','warn');
      $('#crimeContent').innerHTML = `<div class="small muted">London open-data is mostly aggregated (borough-level). If you have a crime feed (point-level), drop it in to visualize.</div>`;
      setStatus('crimeStatus','ok','ok');
      return { points: [], aggregated:true };
    } else {
      // Other countries: try SpotCrime / local feeds
      const c = await fetchSpotCrime(lat,lon,km);
      results.push(...c);
    }
  } catch(e){ console.warn('gatherCrimePoints error', e); }

  // sort by date if available and return
  results.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  setStatus('crimeStatus','ok','ok');
  return { points: results, aggregated:false };
}

/* ========== Main update loop: call when location changes (>=1 meter) ========== */
let lastReported = {lat:null, lon:null};
function distanceMeters(a,b) {
  return haversineKm(a.lat,a.lon,b.lat,b.lon) * 1000;
}

async function updateAll(lat,lon) {
  try {
    // update coords UI (only if element exists)
    const coordsEl = $('#coords');
    if (coordsEl) coordsEl.textContent = `Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}`;
    LAST.lat = lat; LAST.lon = lon;

    // user marker + map
    setUserMarker(lat,lon);

    // show loading placeholders for UI cards so user sees progress
    try { $('#address').textContent = 'Loading address…'; } catch(e){}
    try { $('#crimeContent').innerHTML = '<div class="small muted">Loading nearby incidents…</div>'; } catch(e){}
    try { $('#policeList').innerHTML = '<li class="muted">Loading…</li>'; } catch(e){}
    try { $('#hospList').innerHTML = '<li class="muted">Loading…</li>'; } catch(e){}
    try { $('#fireList').innerHTML = '<li class="muted">Loading…</li>'; } catch(e){}
    try { $('#milList').innerHTML = '<li class="muted">Loading…</li>'; } catch(e){}
    try { $('#touristResults').innerHTML = '<div class="small muted">Loading tourist places…</div>'; } catch(e){}

    // reverse geocode & POIs & weather (parallel)
    await Promise.allSettled([
      reverseGeocode(lat,lon).catch(err => { console.warn('reverseGeocode failed', err); setStatus('addrStatus','error','bad'); $('#address').textContent='Address unavailable'; }),
      fetchWeather(lat,lon).catch(err => { console.warn('fetchWeather failed', err); setStatus('wxStatus','error','bad'); $('#temp').textContent='—'; $('#wind').textContent='—'; $('#wcode').textContent='—'; }),
      fetchPOIs(lat,lon,5000).catch(err => { console.warn('fetchPOIs failed', err); setStatus('polStatus','error','bad'); setStatus('hospStatus','error','bad'); setStatus('fireStatus','error','bad'); setStatus('milStatus','error','bad'); $('#policeList').innerHTML='<li class="muted">POI data unavailable</li>'; $('#hospList').innerHTML='<li class="muted">POI data unavailable</li>'; $('#fireList').innerHTML='<li class="muted">POI data unavailable</li>'; $('#milList').innerHTML='<li class="muted">POI data unavailable</li>'; })
    ]);

    // fetch crimes
    const crim = await gatherCrimePoints(lat,lon, CRIME_RADIUS_KM);
    if(crim.aggregated) {
      // show table/fallback
      // For India aggregated: we attempt to show data.gov.in sample or a note (already handled)
      if(crim.points && crim.points.length) showMapCrimes(crim.points);
    } else {
      // show map markers and a small top list
      showMapCrimes(crim.points);
      // show a short recent list in the card
      const top = crim.points.slice(0,10).map(c => `<li>${fmt(c.type)} • <span class="mono small">${fmt(c.date).slice(0,16)}</span></li>`).join('');
      $('#crimeContent').innerHTML = `<ul>${top}</ul>`;
    }

    // Tourist places
    await fetchTouristPlaces(lat, lon, 5000);

    // GDACS + Relief
    await Promise.allSettled([ fetchGDACS(lat,lon,800), fetchRelief(LAST.country || LAST.city || null, 8) ]);
    

  } catch(e) {
    console.error('updateAll error', e);
  }
}

/* ========== Location watcher (1-meter detection) ========== */
function startWatch() {
  if(!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
  // use best accuracy
  watchId = navigator.geolocation.watchPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    if(lastReported.lat === null) {
      lastReported.lat = lat; lastReported.lon = lon;
      await updateAll(lat,lon);
      return;
    }
    const dist = distanceMeters({lat:lastReported.lat,lon:lastReported.lon}, {lat,lon});
    if(dist >= 1) { // moved at least 1 meter
      lastReported.lat = lat; lastReported.lon = lon;
      await updateAll(lat,lon);
    }
  }, err => {
    console.warn('watchPosition failed', err);
    alert('Location error: ' + (err.message || 'permission denied or unavailable'));
  }, { enableHighAccuracy:true, maximumAge:0, timeout:20000 });
}

/* ========== Tourist Places (Overpass + Wikipedia) ========== */
async function fetchTouristPlaces(lat, lon, radius = 5000) {
  const q = `[out:json][timeout:25]; 
    (nwr[tourism=attraction](around:${radius},${lat},${lon});
     nwr[historic](around:${radius},${lat},${lon});
     nwr[amenity=museum](around:${radius},${lat},${lon});
     nwr[leisure=park](around:${radius},${lat},${lon});
    ); out center 25;`;

  try {
    const j = await overpassQuery(q);
    renderTouristList(j.elements, lat, lon);
    showTouristMarkers(j.elements);
  } catch (e) {
    console.warn("Tourist fetch failed", e);
    $("#touristResults").innerHTML = `<div class="muted">No tourist places found nearby.</div>`;
  }
}

function renderTouristList(elements, lat, lon) {
  if (!elements || !elements.length) {
    $("#touristResults").innerHTML = "<div class='muted'>No tourist places found.</div>";
    return;
  }
  const out = elements.map(el => {
    const n = (el.tags && (el.tags.name || el.tags["name:en"])) || "Tourist place";
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    const d = (elat && elon) ? haversineKm(lat, lon, elat, elon).toFixed(2) : null;

    // Wikipedia link if available
    const wikiKey = el.tags && (el.tags.wikipedia || el.tags["wikidata"]);
    let wikiLink = "";
    if (wikiKey) {
      if (wikiKey.startsWith("http")) wikiLink = wikiKey;
      else wikiLink = `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiKey.split(":").pop())}`;
    }

    const maplink = (elat && elon)
      ? `https://www.openstreetmap.org/?mlat=${elat}&mlon=${elon}#map=17/${elat}/${elon}`
      : "#";

    return `<li>${n}${d ? ` • <span class="mono small">${d} km</span>` : ""}
             • <a href="${maplink}" target="_blank">map</a>
             ${wikiLink ? ` • <a href="${wikiLink}" target="_blank">Wikipedia</a>` : ""}
           </li>`;
  });
  $("#touristResults").innerHTML = `<ul>${out.join("")}</ul>`;
}

function showTouristMarkers(elements) {
  if (!elements || !elements.length) return;
  for (const el of elements) {
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    if (!elat || !elon) continue;

    // small skyblue circle marker (5-10px)
    const dot = L.circleMarker([elat, elon], {
      radius: 6,
      color: "skyblue",
      weight: 1,
      fillColor: "skyblue",
      fillOpacity: 0.9
    });

    const name = (el.tags && (el.tags.name || el.tags["name:en"])) || "Tourist place";
    dot.bindPopup(`<b>${name}</b><br/>Tourist Attraction`);

    clusterLayer.addLayer(dot);
  }
}

$("#loadTouristBtn").addEventListener("click", () => {
  if (LAST.lat && LAST.lon) {
    fetchTouristPlaces(LAST.lat, LAST.lon, 5000);
  } else {
    alert("Location not available yet.");
  }
});


/* ========== Refresh and SOS handlers ========== */
$('#btnRefresh').addEventListener('click', async () => {
  if(LAST.lat && LAST.lon) await updateAll(LAST.lat, LAST.lon);
  else alert('No last-known location. Move to a location or allow location access.');
});

// $("#btnSOS").addEventListener("click", async () => {
//   if (!LAST.lat || !LAST.lon) {
//     alert("Location not available");
//     return;
//   }

//   const msg =
//     `🚨 SOS Emergency Alert 🚨\n\n` +
//     `📍 Location: ${LAST.lat}, ${LAST.lon}\n` +
//     `📌 Address: ${LAST.address || "Not available"}\n\n` +
//     `👉 Please send immediate help!\n`;

//   // Copy message to clipboard
//   await navigator.clipboard.writeText(msg);

//   // Show alert with emergency contacts
//   alert(
//     "✅ SOS message copied to clipboard.\nPaste into SMS/WhatsApp or send to emergency contacts.\n\n" +
//     msg +
//     "\n📞 Emergency Contacts (India):\n" +
//     "👮 Police: 100\n" +
//     "🚒 Fire: 101\n" +
//     "🚑 Ambulance: 108\n" +
//     "📞 National Helpline: 112\n\n" +
//     "👉 You can directly CALL these numbers.\n👉 Or paste the SOS message in WhatsApp/SMS."
//   );
// });


/* ========== Start everything immediately (no click) ========== */
startWatch();

