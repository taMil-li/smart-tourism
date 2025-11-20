// Check if user already gave permission
let hasLocationPermission = false;
let permissionCheckDone = false;

// Check geolocation permission status
async function checkLocationPermission() {
  console.log("Checking location permissions...");

  if (!navigator.geolocation) {
    console.error("Geolocation is not supported by this browser");
    showLocationError("Geolocation is not supported by this browser");
    return;
  }

  if ("permissions" in navigator) {
    try {
      const result = await navigator.permissions.query({
        name: "geolocation",
      });
      hasLocationPermission = result.state === "granted";

      console.log("Permission state:", result.state);

      if (result.state === "denied") {
        showLocationError(
          "Location access has been denied. Please enable location permissions in your browser settings."
        );
        return;
      }

      result.onchange = function () {
        hasLocationPermission = this.state === "granted";
        console.log("Permission changed to:", this.state);

        if (hasLocationPermission && !watchId) {
          console.log("Permission granted, starting location watch...");
          startWatch();
        } else if (!hasLocationPermission && watchId) {
          console.log("Permission revoked, stopping location watch...");
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      };
    } catch (error) {
      console.log(
        "Permissions API not supported, will attempt geolocation directly"
      );
      hasLocationPermission = true; // Assume allowed, will check during actual request
    }
  } else {
    console.log("Permissions API not available");
    hasLocationPermission = true; // Assume allowed
  }
  permissionCheckDone = true;
}

function showLocationError(message) {
  console.error("Location Error:", message);

  // Update UI to show error
  const coordsEl = $("#coords");
  if (coordsEl) {
    coordsEl.textContent = "Location unavailable";
    coordsEl.style.color = "var(--bad)";
  }

  // Show instructions
  const locationHelp = document.createElement("div");
  locationHelp.style.cssText = `
    background: var(--card);
    border: 2px solid var(--bad);
    border-radius: 8px;
    padding: 16px;
    margin: 16px;
    text-align: center;
  `;
  locationHelp.innerHTML = `
    <h3 style="color: var(--bad); margin-top: 0;">Location Access Required</h3>
    <p>${message}</p>
    <p><strong>To enable location:</strong></p>
    <ol style="text-align: left; display: inline-block;">
      <li>Click the location icon in your browser's address bar</li>
      <li>Select "Allow" for location permissions</li>
      <li>Refresh this page</li>
    </ol>
    <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: var(--accent); color: #000; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
  `;

  // Insert after header
  const header = document.querySelector("header");
  if (header) {
    header.insertAdjacentElement("afterend", locationHelp);
  }
}

// Utilities
const $ = (s) => document.querySelector(s);
const setStatus = (id, text, cls = "muted") => {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = "pill " + cls;
  }
};
const fmt = (v, d = "—") => (v === undefined || v === null || v === "" ? d : v);
const R = 6371;

// JWT helpers for logout/signout
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
}
function clearJWTToken() {
  document.cookie = "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  try {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user_data_hash");
  } catch (e) {}
  try {
    sessionStorage.removeItem("jwt");
    sessionStorage.removeItem("user_data_hash");
  } catch (e) {}
}

// Auth check: verify JWT and redirect to if invalid/missing
async function checkAuthentication() {
  const jwt = getCookie("jwt");
  if (!jwt) {
    // window.location.href = "../authenticate/login.html";
    return false;
  }
  try {
    const res = await fetch("https://smart-tourism-backend-2.onrender.com/api/verify-token", {
      method: "GET",
      headers: { authorization: jwt },
    });
    const result = await res.json();
    if (res.status !== 200 || !result.valid) {
      clearJWTToken();
      window.location.href = "../authenticate/login.html";
      return false;
    }
    return true;
  } catch (e) {
    clearJWTToken();
    window.location.href = "../authenticate/login.html";
    return false;
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Global state
let LAST = {
  lat: null,
  lon: null,
  address: null,
  city: null,
  country: null,
};
let watchId = null;
let map = null,
  userMarker = null,
  clusterLayer = null,
  heatLayer = null;
let markers = [];
const CRIME_RADIUS_KM = 10;
let locationRetryCount = 0;
const MAX_LOCATION_RETRIES = 3;

// Map initialization with error handling
function initMap() {
  try {
    if (!document.getElementById("map")) {
      console.error("Map container not found!");
      setTimeout(initMap, 100);
      return;
    }

    map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([20.5937, 78.9629], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    clusterLayer = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    map.addLayer(clusterLayer);

    heatLayer = L.layerGroup().addTo(map);

    console.log("Map initialized successfully");
  } catch (error) {
    console.error("Map initialization failed:", error);
    setTimeout(initMap, 1000);
  }
}

// DOM ready check and initialization
function initializeApp() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
    return;
  }

  console.log("Initializing app...");

  // Initialize i18n (after DOM ready)
  if (window.I18N && typeof window.I18N.init === "function") {
    window.I18N.init("en");
  }

  // Initialize the map immediately (do not gate map rendering on auth)
  try {
    initMap();
  } catch (err) {
    console.error('initMap failed during initializeApp:', err);
  }

  // Check location permission
  checkLocationPermission();

  // Set up event listeners with error handling
  setupEventListeners();

  // Start location watching after a brief delay to ensure DOM is ready
  setTimeout(() => {
    if (permissionCheckDone) {
      startWatch();
    } else {
      setTimeout(startWatch, 1000);
    }
  }, 500);

  // Still verify authentication in background (may redirect if invalid)
  checkAuthentication().then((isOK) => {
    if (!isOK) {
      // If not authenticated, we simply keep the map visible but do not enable auth-only features
      console.log('User not authenticated; map and public features remain available.');
    }
  });
}

function setupEventListeners() {
  try {
    // Redirect to signup and login pages
    const signupBtn = document.getElementById("signup");
    const loginBtn = document.getElementById("login");
    const refreshBtn = document.getElementById("btnRefresh");
    const sosBtn = document.getElementById("sosBtn");
    const touristBtn = document.getElementById("tourDetails");
    const logoutBtn = document.getElementById("logoutBtn");
    const signOutBtn = document.getElementById("signOutBtn");
    const signoutModal = document.getElementById("signoutModal");
    const signoutForm = document.getElementById("signoutForm");
    const signoutClose = document.getElementById("signoutClose");
    const signoutCancel = document.getElementById("signoutCancel");
    const soUserHash = document.getElementById("so_user_hash");
    const soGovSig = document.getElementById("so_gov_sig");
    const signoutMsg = document.getElementById("signoutMsg");
    

    if (signupBtn) {
      signupBtn.addEventListener("click", function () {
        window.location.href = "../authenticate/signup.html";
      });
    }

    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        window.location.href = "../authenticate/login.html";
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (LAST.lat && LAST.lon) {
          await updateAll(LAST.lat, LAST.lon);
        } else {
          alert(
            "No last-known location. Move to a location or allow location access."
          );
        }
      });
    }

    if (sosBtn) {
      sosBtn.addEventListener("click", handleSOS);
    }

    if (touristBtn) {
      touristBtn.addEventListener("click", () => {
        const popup = document.getElementById("tourDetailsPopup");
        if (popup) popup.style.display = "block";
      });
    }

    // Logout handler
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const jwt = getCookie("jwt");
        if (jwt) {
          fetch("https://smart-tourism-backend-2.onrender.com/api/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: jwt,
            },
          }).catch(() => {});
        }
        clearJWTToken();
        window.location.href = "../authenticate/login.html";
      });
    }

    // Sign Out open modal
    if (signOutBtn) {
      signOutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          if (soUserHash)
            soUserHash.value =
              localStorage.getItem("user_data_hash") ||
              sessionStorage.getItem("user_data_hash") ||
              "";
        } catch (e) {}
        if (signoutMsg) {
          signoutMsg.textContent = "";
          signoutMsg.style.color = "#e9f1ff";
        }
        if (soGovSig) soGovSig.value = "";
        if (signoutModal) signoutModal.style.display = "flex";
      });
    }

    // Modal close/cancel
    if (signoutClose)
      signoutClose.addEventListener("click", () => {
        if (signoutModal) signoutModal.style.display = "none";
      });
    if (signoutCancel)
      signoutCancel.addEventListener("click", () => {
        if (signoutModal) signoutModal.style.display = "none";
      });

    // Sign Out submit
    if (signoutForm) {
      signoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const jwt = getCookie("jwt");
        if (!jwt) {
          clearJWTToken();
          window.location.href = "../authenticate/login.html";
          return;
        }
        const userHash =
          soUserHash && soUserHash.value ? soUserHash.value.trim() : "";
        const govtSig = soGovSig && soGovSig.value ? soGovSig.value.trim() : "";
        if (!userHash || !govtSig) {
          if (signoutMsg) {
            signoutMsg.textContent = "Please fill all required fields";
            signoutMsg.style.color = "#ff8a8a";
          }
          return;
        }
        try {
          const r = await fetch("https://smart-tourism-backend-2.onrender.com/api/signout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: jwt,
            },
            body: JSON.stringify({
              user_data_hash: userHash,
              govt_signout_signature: govtSig,
            }),
          });
          if (r.ok) {
            if (signoutMsg) {
              signoutMsg.textContent = "Account deactivated successfully.";
              signoutMsg.style.color = "#89f0a2";
            }
            setTimeout(() => {
              clearJWTToken();
              window.location.href = "../authenticate/login.html";
            }, 800);
          } else {
            const j = await r.json().catch(() => ({}));
            if (signoutMsg) {
              signoutMsg.textContent = j.error || "Signout failed";
              signoutMsg.style.color = "#ff8a8a";
            }
          }
        } catch (err) {
          if (signoutMsg) {
            signoutMsg.textContent = "Network error during signout";
            signoutMsg.style.color = "#ff8a8a";
          }
        }
      });
    }
  } catch (error) {
    console.error("Error setting up event listeners:", error);
  }
}
// Add event listener for crowd image redirect
const crowdImg = document.getElementById("crowdDetector");
if (crowdImg) {
  crowdImg.style.cursor = "pointer";
  crowdImg.addEventListener("click", function () {
    window.location.href = "http://localhost:8501/";
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const travelDetailsBtn = document.getElementById("travelDetailsBtn");
  const fairPriceBtn = document.getElementById("fairPriceBtn");
  if (travelDetailsBtn) {
    travelDetailsBtn.addEventListener("click", function () {
      window.location.href = "../transportation/transport_availability.html";
    });
  }
  if (fairPriceBtn) {
    fairPriceBtn.addEventListener("click", function () {
      window.location.href = "../transportation/fair_details.html";
    });
  }
  // Transport popup logic
  const transportBtn = document.getElementById("transportBtn");
  const transportPopup = document.getElementById("transportPopup");
  const closeTransportPopup = document.getElementById("closeTransportPopup");
  if (transportBtn && transportPopup) {
    transportBtn.addEventListener("click", function () {
      transportPopup.style.display = "block";
    });
  }
  if (closeTransportPopup && transportPopup) {
    closeTransportPopup.addEventListener("click", function () {
      transportPopup.style.display = "none";
    });
  }

  // Tour Details popup logic
  const tourDetailsPopup = document.getElementById("tourDetailsPopup");
  const getPlaceDetailsBtn = document.getElementById("getPlaceDetailsBtn");
  const getMeasuresBtn = document.getElementById("getMeasuresBtn");
  const closeTourDetailsPopup = document.getElementById(
    "closeTourDetailsPopup"
  );
  if (getPlaceDetailsBtn) {
    getPlaceDetailsBtn.addEventListener("click", function () {
      window.location.href = "../place_details/place_details.html";
    });
  }
  if (getMeasuresBtn) {
    getMeasuresBtn.addEventListener("click", function () {
      window.location.href = "../tour_guide/tour_guide.html";
    });
  }
  if (closeTourDetailsPopup && tourDetailsPopup) {
    closeTourDetailsPopup.addEventListener("click", function () {
      tourDetailsPopup.style.display = "none";
    });
  }
});

document.getElementById('tourBuddy').addEventListener('click', async () => {
  const fetched = await fetch('https://smart-tourism-backend-2.onrender.com/api/tourbuddy-url')
  const data = await fetched.json();
  console.log(data);
  if(data) {
    window.location.href = data.tourBuddy;
  }
});

async function handleSOS() {
  if (!LAST.lat || !LAST.lon) {
    alert("Location not available for SOS. Please enable location services.");
    return;
  }

  const msg =
    `🚨 SOS Emergency Alert 🚨\n\n` +
    `📍 Location: ${LAST.lat}, ${LAST.lon}\n` +
    `📌 Address: ${LAST.address || "Not available"}\n\n` +
    `👉 Please send immediate help!\n`;

  try {
    await navigator.clipboard.writeText(msg);
    alert(
      "✅ SOS message copied to clipboard.\nPaste into SMS/WhatsApp or send to emergency contacts.\n\n" +
        msg +
        "\n📞 Emergency Contacts (India):\n" +
        "👮 Police: 100\n" +
        "🚒 Fire: 101\n" +
        "🚑 Ambulance: 108\n" +
        "📞 National Helpline: 112\n\n" +
        "👉 You can directly CALL these numbers.\n👉 Or paste the SOS message in WhatsApp/SMS."
    );
  } catch (error) {
    console.error("Clipboard write failed:", error);
    alert("Could not copy to clipboard. Please manually copy:\n\n" + msg);
  }
}

// Location watcher with improved error handling
function startWatch() {
  if (!("geolocation" in navigator)) {
    alert("Geolocation not supported by this browser");
    return;
  }

  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  console.log("Starting location watch...");

  const options = {
    enableHighAccuracy: true,
    maximumAge: 10000, // 10 seconds
    timeout: 30000, // 30 seconds
  };

  watchId = navigator.geolocation.watchPosition(
    async (position) => {
      locationRetryCount = 0; // Reset retry count on success
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      console.log(`Location obtained: ${lat}, ${lon}`);

      if (lastReported.lat === null) {
        lastReported.lat = lat;
        lastReported.lon = lon;
        await updateAll(lat, lon);
        return;
      }

      const dist = distanceMeters(
        { lat: lastReported.lat, lon: lastReported.lon },
        { lat, lon }
      );
      if (dist >= 1) {
        // moved at least 1 meter
        lastReported.lat = lat;
        lastReported.lon = lon;
        await updateAll(lat, lon);
      }
    },
    (error) => {
      locationRetryCount++;
      console.error("Location error:", error.message, "Code:", error.code);

      let message = "Location access failed: ";
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message +=
            "Location access was denied. Please allow location access and refresh the page.";
          break;
        case error.POSITION_UNAVAILABLE:
          message +=
            "Location information is unavailable. Please check your GPS settings.";
          break;
        case error.TIMEOUT:
          message += "Location request timed out. Trying again...";
          break;
        default:
          message += "An unknown error occurred while retrieving location.";
          break;
      }

      // Show error but don't spam alerts
      if (locationRetryCount <= MAX_LOCATION_RETRIES) {
        console.log(message);
        if (error.code === error.PERMISSION_DENIED) {
          alert(message);
        }
      }

      // Retry with less strict options after failures
      if (locationRetryCount === 2) {
        console.log("Retrying with less strict location options...");
        const fallbackOptions = {
          enableHighAccuracy: false,
          maximumAge: 60000,
          timeout: 15000,
        };

        setTimeout(() => {
          if (watchId) {
            navigator.geolocation.clearWatch(watchId);
          }
          watchId = navigator.geolocation.watchPosition(
            async (pos) => {
              const lat = pos.coords.latitude;
              const lon = pos.coords.longitude;
              console.log(`Fallback location obtained: ${lat}, ${lon}`);
              if (
                lastReported.lat === null ||
                distanceMeters(
                  { lat: lastReported.lat, lon: lastReported.lon },
                  { lat, lon }
                ) >= 10
              ) {
                lastReported.lat = lat;
                lastReported.lon = lon;
                await updateAll(lat, lon);
              }
            },
            (err) => console.error("Fallback location also failed:", err),
            fallbackOptions
          );
        }, 2000);
      }
    },
    options
  );
}

// Place "You are here" marker
function setUserMarker(lat, lon) {
  try {
    if (!map) {
      console.error("Map not initialized when setting user marker");
      return;
    }

    if (userMarker) map.removeLayer(userMarker);

    userMarker = L.marker([lat, lon], {
      title: "You are here",
      riseOnHover: true,
    })
      .addTo(map)
      .bindPopup("<b>You are here</b>")
      .openPopup();

    map.setView([lat, lon], 14);
  } catch (error) {
    console.error("Error setting user marker:", error);
  }
}

// Distance calculation
let lastReported = { lat: null, lon: null };

function distanceMeters(a, b) {
  return haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
}

// Reverse geocoding
async function reverseGeocode(lat, lon) {
  setStatus("addrStatus", "loading…");
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      timeout: 10000,
    });

    if (!r.ok) throw new Error("Nominatim request failed");

    const json = await r.json();
    $("#address").textContent = json.display_name || "Unknown";

    const a = json.address || {};
    $("#admin").textContent = [
      a.suburb,
      a.city || a.town || a.village || a.hamlet,
      a.state,
      a.postcode,
      a.country,
    ]
      .filter(Boolean)
      .join(" • ");

    LAST.city = a.city || a.town || a.village || a.hamlet || null;
    LAST.country = a.country || null;
    LAST.address = json.display_name || null;

    setStatus("addrStatus", "ok", "ok");
  } catch (error) {
    console.error("Reverse geocoding failed:", error);
    setStatus("addrStatus", "error", "bad");
    $("#address").textContent = "Location unavailable";
  }
}

// Weather fetching
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
    99: "Severe Thunderstorm with Hail",
  };
  return weatherDescriptions[weatherCode] || "Unknown Weather";
}

async function fetchWeather(lat, lon) {
  setStatus("wxStatus", "loading…");
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const r = await fetch(url, { timeout: 10000 });

    if (!r.ok) throw new Error("Open-Meteo request failed");

    const j = await r.json();
    const c = j.current_weather || {};

    $("#temp").textContent = fmt(c.temperature);
    $("#wind").textContent = fmt(c.windspeed);
    $("#wcode").textContent = fmt(getWeather(c.weathercode, c.is_day));
    $("#wtime").textContent = fmt(c.time);

    setStatus("wxStatus", "ok", "ok");
  } catch (error) {
    console.error("Weather fetch failed:", error);
    setStatus("wxStatus", "error", "bad");
  }
}

// Tourist places functionality
async function fetchTouristPlaces(lat, lon, radius = 5000) {
  try {
    const q = `[out:json][timeout:25]; 
      (nwr[tourism=attraction](around:${radius},${lat},${lon});
       nwr[historic](around:${radius},${lat},${lon});
       nwr[amenity=museum](around:${radius},${lat},${lon});
       nwr[leisure=park](around:${radius},${lat},${lon});
      ); out center 25;`;

    const j = await overpassQuery(q);
    renderTouristList(j.elements, lat, lon);
    showTouristMarkers(j.elements);
  } catch (e) {
    console.warn("Tourist fetch failed", e);
    $(
      "#touristResults"
    ).innerHTML = `<div class="muted">No tourist places found nearby.</div>`;
  }
}

async function overpassQuery(q) {
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: q,
  });
  if (!r.ok) throw new Error("Overpass failed");
  return r.json();
}

function renderTouristList(elements, lat, lon) {
  const resultsEl = $("#touristResults");
  if (!resultsEl) return;

  if (!elements || !elements.length) {
    resultsEl.innerHTML = "<div class='muted'>No tourist places found.</div>";
    return;
  }

  const out = elements.map((el) => {
    const n =
      (el.tags && (el.tags.name || el.tags["name:en"])) || "Tourist place";
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    const d =
      elat && elon ? haversineKm(lat, lon, elat, elon).toFixed(2) : null;

    const wikiKey = el.tags && (el.tags.wikipedia || el.tags["wikidata"]);
    let wikiLink = "";
    if (wikiKey) {
      if (wikiKey.startsWith("http")) wikiLink = wikiKey;
      else
        wikiLink = `https://en.wikipedia.org/wiki/${encodeURIComponent(
          wikiKey.split(":").pop()
        )}`;
    }

    const maplink =
      elat && elon
        ? `https://www.openstreetmap.org/?mlat=${elat}&mlon=${elon}#map=17/${elat}/${elon}`
        : "#";

    return `<li>${n}${d ? ` • <span class="mono small">${d} km</span>` : ""}
             • <a href="${maplink}" target="_blank">map</a>
             ${
               wikiLink
                 ? ` • <a href="${wikiLink}" target="_blank">Wikipedia</a>`
                 : ""
             }
           </li>`;
  });
  resultsEl.innerHTML = out.join("");
}

function showTouristMarkers(elements) {
  if (!elements || !elements.length || !clusterLayer) return;

  for (const el of elements) {
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    if (!elat || !elon) continue;

    const dot = L.circleMarker([elat, elon], {
      radius: 6,
      color: "skyblue",
      weight: 1,
      fillColor: "skyblue",
      fillOpacity: 0.9,
    });

    const name =
      (el.tags && (el.tags.name || el.tags["name:en"])) || "Tourist place";
    dot.bindPopup(`<b>${name}</b><br/>Tourist Attraction`);

    clusterLayer.addLayer(dot);
  }
}

// Crime data visualization
function showTableCrimes(crimes) {
  const container = $("#crimeContent");
  if (!container) return;

  if (!crimes || !crimes.length) {
    container.innerHTML =
      '<div class="small muted">No recent crimes found.</div>';
    return;
  }

  let html = `<table class="crime-table"><thead><tr><th>Date</th><th>Type</th><th>Location</th><th>Source</th></tr></thead><tbody>`;
  for (const c of crimes.slice(0, 200)) {
    html += `<tr><td class="mono small">${fmt(c.date)}</td><td>${
      c.type || "—"
    }</td><td>${
      c.place || (c.lat ? `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}` : "—")
    }</td><td><a href="${c.source || "#"}" target="_blank">link</a></td></tr>`;
  }
  html += "</tbody></table>";
  container.innerHTML = html;
}

function showMapCrimes(crimes) {
  if (!clusterLayer || !heatLayer) return;

  clusterLayer.clearLayers();
  heatLayer.clearLayers();
  markers = [];

  if (!crimes || crimes.length === 0) {
    const container = $("#crimeContent");
    if (container) {
      container.innerHTML =
        '<div class="small muted">No nearby incidents.</div>';
    }
    return;
  }

  const container = $("#crimeContent");
  if (container) container.innerHTML = "";

  const heatPoints = [];
  for (const c of crimes) {
    if (!c.lat || !c.lon) continue;

    const dot = L.circleMarker([c.lat, c.lon], {
      radius: 6,
      color: "#ff3b3b",
      weight: 1,
      fillColor: "#ff3b3b",
      fillOpacity: 0.9,
    });

    const popupHtml = `<div style="max-width:260px;">
      <strong>${c.type || "Crime"}</strong><br/>
      <small class="mono">${fmt(c.date)}</small><br/>
      ${c.desc ? `<div style="margin-top:6px;">${c.desc}</div>` : ""}
      ${
        c.source
          ? `<div style="margin-top:6px;"><a target="_blank" href="${c.source}">source</a></div>`
          : ""
      }
    </div>`;
    dot.bindPopup(popupHtml);

    const mini = L.divIcon({
      className: "crime-mini",
      html: `<div title="${c.type || ""}">${(c.type || "").slice(0, 20)}</div>`,
      iconSize: [1, 1],
      popupAnchor: [0, -6],
    });
    const miniMarker = L.marker([c.lat, c.lon], {
      icon: mini,
      interactive: false,
      zIndexOffset: 1000,
    });

    clusterLayer.addLayer(dot);
    clusterLayer.addLayer(miniMarker);
    heatPoints.push([c.lat, c.lon, 0.5]);
    markers.push(dot);
  }

  if (heatPoints.length) {
    const heat = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 30,
      maxZoom: 15,
    });
    heatLayer.addLayer(heat);
  }
}

// POI fetching and rendering
async function fetchPOIs(lat, lon, radius = 5000) {
  radius = Math.min(Math.max(radius, 1000), 10000);

  // Police
  setStatus("polStatus", "loading…");
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=police](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList("policeList", j.elements, lat, lon, "Police Station");
    setStatus("polStatus", "ok", "ok");
  } catch (e) {
    setStatus("polStatus", "error", "bad");
    const policeList = $("#policeList");
    if (policeList)
      policeList.innerHTML = `<li class="error">${e.message}</li>`;
  }

  // Hospital
  setStatus("hospStatus", "loading…");
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=hospital](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList("hospList", j.elements, lat, lon, "Hospital");
    setStatus("hospStatus", "ok", "ok");
  } catch (e) {
    setStatus("hospStatus", "error", "bad");
    const hospList = $("#hospList");
    if (hospList) hospList.innerHTML = `<li class="error">${e.message}</li>`;
  }

  // Fire stations
  setStatus("fireStatus", "loading…");
  try {
    const q = `[out:json][timeout:25]; nwr[amenity=fire_station](around:${radius},${lat},${lon}); out center 20;`;
    const j = await overpassQuery(q);
    renderPOIList("fireList", j.elements, lat, lon, "Fire Station");
    setStatus("fireStatus", "ok", "ok");
  } catch (e) {
    setStatus("fireStatus", "error", "bad");
    const fireList = $("#fireList");
    if (fireList) fireList.innerHTML = `<li class="error">${e.message}</li>`;
  }

  // Military/restricted areas
  setStatus("milStatus", "loading…");
  try {
    const q = `[out:json][timeout:30];
      ( nwr[landuse=military](around:${radius},${lat},${lon});
        nwr[military](around:${radius},${lat},${lon});
        nwr[barrier=border_control](around:${radius},${lat},${lon});
      );
      out center 40;`;
    const j = await overpassQuery(q);
    renderPOIList("milList", j.elements, lat, lon, "Restricted Area");
    setStatus("milStatus", "ok", "ok");
  } catch (e) {
    setStatus("milStatus", "error", "bad");
    const milList = $("#milList");
    if (milList) milList.innerHTML = `<li class="error">${e.message}</li>`;
  }
}

function renderPOIList(containerId, elements, lat, lon, fallback) {
  const ul = document.getElementById(containerId);
  if (!ul) return;

  if (!elements || !elements.length) {
    ul.innerHTML = '<li class="muted">None found in radius.</li>';
    return;
  }

  const out = elements.map((el) => {
    const n = (el.tags && (el.tags.name || el.tags["name:en"])) || fallback;
    const elat = el.lat || (el.center && el.center.lat);
    const elon = el.lon || (el.center && el.center.lon);
    const d =
      elat && elon ? haversineKm(lat, lon, elat, elon).toFixed(2) : null;
    const maplink =
      elat && elon
        ? `https://www.openstreetmap.org/?mlat=${elat}&mlon=${elon}#map=17/${elat}/${elon}`
        : "#";
    return `<li>${n}${
      d ? ` • <span class="mono small">${d} km</span>` : ""
    } • <a href="${maplink}" target="_blank">map</a></li>`;
  });
  ul.innerHTML = out.join("");
}

// GDACS disaster alerts
async function fetchGDACS(lat, lon, withinKm = 800) {
  setStatus("gdacsStatus", "loading…");
  try {
    async function tfetch(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error("fetch failure");
      return r.text();
    }

    let xml;
    try {
      xml = await tfetch("https://www.gdacs.org/rss.aspx");
    } catch {
      xml = await tfetch(
        "https://api.allorigins.win/raw?url=" +
          encodeURIComponent("https://www.gdacs.org/rss.aspx")
      );
    }

    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const items = [...doc.getElementsByTagName("item")];
    const list = [];

    for (const it of items.slice(0, 40)) {
      const title = it.getElementsByTagName("title")[0]?.textContent || "Alert";
      const link = it.getElementsByTagName("link")[0]?.textContent || "#";
      const latN = parseFloat(
        it.getElementsByTagName("geo:lat")[0]?.textContent || "NaN"
      );
      const lonN = parseFloat(
        it.getElementsByTagName("geo:long")[0]?.textContent || "NaN"
      );

      if (!Number.isNaN(latN) && !Number.isNaN(lonN)) {
        const d = haversineKm(lat, lon, latN, lonN);
        if (d <= withinKm) {
          list.push(
            `<li><a target="_blank" href="${link}">${title}</a> • <span class="mono small">${Math.round(
              d
            )} km</span></li>`
          );
        }
      }
    }

    const gdacsList = $("#gdacsList");
    if (gdacsList) {
      gdacsList.innerHTML = list.length
        ? list.join("")
        : '<li class="muted">No nearby GDACS alerts.</li>';
    }
    setStatus("gdacsStatus", "ok", "ok");
  } catch (error) {
    console.error("GDACS fetch failed:", error);
    setStatus("gdacsStatus", "error", "bad");
  }
}

// ReliefWeb security reports
async function fetchRelief(countryHint = null, limit = 8) {
  setStatus("reliefStatus", "loading…");
  try {
    const query = encodeURIComponent(
      countryHint
        ? `security OR terrorism ${countryHint}`
        : "security OR terrorism"
    );
    const url = `https://api.reliefweb.int/v1/reports?appname=free-safety-app&query[value]=${query}&limit=${limit}&profile=full`;

    const r = await fetch(url);
    if (!r.ok) throw new Error("ReliefWeb fetch failed");

    const j = await r.json();
    const lines = (j.data || []).map((item) => {
      const t = item.fields?.title || "Report";
      const l = item.fields?.url || "#";
      const s = item.fields?.source
        ?.map((x) => x.shortname || x.name)
        .join(", ");
      const d = item.fields?.date?.original || "";
      return `<li><a target="_blank" href="${l}">${t}</a> • <span class="small muted">${s}</span> • <span class="mono small">${d.slice(
        0,
        10
      )}</span></li>`;
    });

    const reliefList = $("#reliefList");
    if (reliefList) {
      reliefList.innerHTML = lines.length
        ? lines.join("")
        : '<li class="muted">No recent reports found.</li>';
    }
    setStatus("reliefStatus", "ok", "ok");
  } catch (e) {
    const reliefList = $("#reliefList");
    if (reliefList) {
      reliefList.innerHTML = `<li class="muted">No Recent Security/Terrorism reports found</li>`;
    }
    console.log(e.message);
    setStatus("reliefStatus", "error", "bad");
  }
}

// Simplified crime data gathering (placeholder)
async function gatherCrimePoints(lat, lon, km = 10) {
  setStatus("crimeStatus", "loading…");

  // For demo purposes, return empty results
  // In real implementation, you would fetch from various crime APIs
  const results = [];

  setStatus("crimeStatus", "ok", "ok");
  return { points: results, aggregated: false };
}

// Main update function
async function updateAll(lat, lon) {
  try {
    console.log(`Updating all data for location: ${lat}, ${lon}`);

    // Update coordinates display
    const coordsEl = $("#coords");
    if (coordsEl) {
      coordsEl.textContent = `Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}`;
    }

    LAST.lat = lat;
    LAST.lon = lon;

    // Set user marker on map
    setUserMarker(lat, lon);

    // Parallel requests for basic data
    await Promise.allSettled([
      reverseGeocode(lat, lon),
      fetchWeather(lat, lon),
      fetchPOIs(lat, lon, 5000),
    ]);

    // Fetch crime data
    const crim = await gatherCrimePoints(lat, lon, CRIME_RADIUS_KM);
    if (crim.aggregated) {
      if (crim.points && crim.points.length) showMapCrimes(crim.points);
    } else {
      showMapCrimes(crim.points);
      const crimeContent = $("#crimeContent");
      if (crimeContent && crim.points && crim.points.length > 0) {
        const top = crim.points
          .slice(0, 10)
          .map(
            (c) =>
              `<li>${fmt(c.type)} • <span class="mono small">${fmt(
                c.date
              ).slice(0, 16)}</span></li>`
          )
          .join("");
        crimeContent.innerHTML = `<ul>${top}</ul>`;
      }
    }

    // Fetch tourist places
    await fetchTouristPlaces(lat, lon, 5000);

    // Fetch alerts and reports
    await Promise.allSettled([
      fetchGDACS(lat, lon, 800),
      fetchRelief(LAST.country || LAST.city || null, 8),
    ]);
  } catch (error) {
    console.error("updateAll error:", error);
  }
}

// Initialize the application
initializeApp();
