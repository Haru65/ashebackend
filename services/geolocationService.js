const axios = require('axios');

/**
 * Geolocation Service
 * Provides reverse geocoding and location utilities
 */

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/reverse';
const locationCache = new Map();

const COMMON_LOCATIONS = [
  { lat: 19.05, lon: 72.8667, name: 'Sion East, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.076, lon: 72.877, name: 'Sion East, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.055, lon: 72.872, name: 'Currey Road, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.015, lon: 72.856, name: 'Worli, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.047, lon: 72.821, name: 'Fort, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.089, lon: 72.836, name: 'Kala Ghoda, Mumbai, Maharashtra, India', tolerance: 0.01 },
  { lat: 19.05, lon: 72.87, name: 'Mumbai, Maharashtra, India', tolerance: 0.05 },
  { lat: 28.70, lon: 77.10, name: 'New Delhi, India', tolerance: 0.05 },
  { lat: 13.34, lon: 74.74, name: 'Mangalore, Karnataka, India', tolerance: 0.05 },
  { lat: 15.50, lon: 73.83, name: 'Goa, India', tolerance: 0.05 },
  { lat: 12.97, lon: 77.59, name: 'Bangalore, Karnataka, India', tolerance: 0.05 },
  { lat: 18.52, lon: 73.86, name: 'Pune, Maharashtra, India', tolerance: 0.05 },
];

function getCacheKey(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

function getCommonLocation(lat, lon) {
  return COMMON_LOCATIONS.find(location =>
    Math.abs(lat - location.lat) < location.tolerance &&
    Math.abs(lon - location.lon) < location.tolerance
  )?.name || null;
}

function formatAddress(data) {
  const addr = data?.address || {};
  const parts = [];

  if (addr.neighbourhood) parts.push(addr.neighbourhood);
  else if (addr.suburb) parts.push(addr.suburb);
  else if (addr.city_district) parts.push(addr.city_district);
  else if (addr.village) parts.push(addr.village);

  if (addr.city) parts.push(addr.city);
  else if (addr.town) parts.push(addr.town);
  else if (addr.hamlet) parts.push(addr.hamlet);

  if (addr.county) parts.push(addr.county);
  else if (addr.state_district) parts.push(addr.state_district);

  if (addr.state) parts.push(addr.state);
  if (addr.country) parts.push(addr.country);

  const locationName = Array.from(new Set(parts.filter(Boolean))).join(', ');
  return locationName || data?.display_name || null;
}

/**
 * Reverse geocode coordinates to get location name
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<string>} - Location name or "Unknown"
 */
async function reverseGeocode(lat, lon) {
  try {
    const latitude = Number(lat);
    const longitude = Number(lon);

    if (isNaN(latitude) || isNaN(longitude) || (latitude === 0 && longitude === 0)) {
      return null;
    }

    const cacheKey = getCacheKey(latitude, longitude);
    const cached = locationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      return cached.name;
    }

    const commonLocation = getCommonLocation(latitude, longitude);
    if (commonLocation) {
      locationCache.set(cacheKey, { name: commonLocation, timestamp: Date.now() });
      return commonLocation;
    }

    console.log(`🌍 Reverse geocoding: ${latitude}, ${longitude}`);

    const response = await axios.get(NOMINATIM_API, {
      params: {
        format: 'json',
        lat: latitude,
        lon: longitude,
        zoom: 18,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'ASHECONTROL-IoT-Platform/1.0'
      },
      timeout: 5000 // 5 second timeout
    });

    if (response.data && response.data.address) {
      const locationName = formatAddress(response.data);
      console.log(`✅ Geocoded to: ${locationName}`);

      if (locationName) {
        locationCache.set(cacheKey, { name: locationName, timestamp: Date.now() });
      }
      return locationName || 'Unknown Location';
    }

    return null;
  } catch (error) {
    console.warn(`⚠️ Reverse geocoding failed: ${error.message}`);
    return null;
  }
}

/**
 * Parse coordinates from string
 * Supports formats: "19.076, 72.8777" or "lat,lon"
 * @param {string} coordString - Coordinate string
 * @returns {Object|null} - {lat, lon} or null if invalid
 */
function parseCoordinates(coordString) {
  if (!coordString || typeof coordString !== 'string') {
    return null;
  }

  const parts = coordString.split(',').map(p => parseFloat(p.trim()));
  
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return {
      lat: parts[0],
      lon: parts[1]
    };
  }

  return null;
}

/**
 * Format coordinates as string
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string} - "lat, lon" format
 */
function formatCoordinates(lat, lon) {
  if (!lat || !lon) return null;
  return `${lat}, ${lon}`;
}

async function reverseGeocodeResponse(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const location = await reverseGeocode(latitude, longitude);

  return {
    success: true,
    data: {
      display_name: location || `${latitude}, ${longitude}`,
      address: {
        city_name: location || `${latitude}, ${longitude}`,
        latitude,
        longitude
      }
    },
    fallback: !location
  };
}

module.exports = {
  reverseGeocode,
  reverseGeocodeResponse,
  parseCoordinates,
  formatCoordinates
};
