const axios = require('axios');

/**
 * Geolocation Service
 * Provides reverse geocoding and location utilities
 */

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/reverse';

/**
 * Reverse geocode coordinates to get location name
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<string>} - Location name or "Unknown"
 */
async function reverseGeocode(lat, lon) {
  try {
    if (!lat || !lon) {
      return null;
    }

    console.log(`🌍 Reverse geocoding: ${lat}, ${lon}`);

    const response = await axios.get(NOMINATIM_API, {
      params: {
        format: 'json',
        lat: lat,
        lon: lon,
        zoom: 18,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'ASHECONTROL-IoT-Platform/1.0'
      },
      timeout: 5000 // 5 second timeout
    });

    if (response.data && response.data.address) {
      const addr = response.data.address;
      
      // Build location string from address components
      let location = [];
      
      // Try to get a meaningful location name
      if (addr.village) location.push(addr.village);
      if (addr.town) location.push(addr.town);
      if (addr.city) location.push(addr.city);
      if (addr.district) location.push(addr.district);
      if (addr.county) location.push(addr.county);
      if (addr.state) location.push(addr.state);
      if (addr.country) location.push(addr.country);

      const locationName = location.slice(0, 3).join(', '); // Get top 3 components
      console.log(`✅ Geocoded to: ${locationName}`);
      
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

module.exports = {
  reverseGeocode,
  parseCoordinates,
  formatCoordinates
};
