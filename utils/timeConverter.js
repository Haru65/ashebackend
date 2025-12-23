/**
 * Time Converter Utilities
 * Converts between seconds and HH:MM:SS format
 */

/**
 * Convert seconds to HH:MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Time in HH:MM:SS format
 */
function secondsToHHMMSS(seconds) {
  if (typeof seconds !== 'number' || seconds < 0) {
    console.warn(`⚠️ Invalid seconds value: ${seconds}, returning "00:00:00"`);
    return "00:00:00";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map(val => String(val).padStart(2, '0'))
    .join(':');
}

/**
 * Convert HH:MM:SS format to seconds
 * @param {string} timeString - Time in HH:MM:SS format (e.g., "01:30:45")
 * @returns {number} Time in seconds
 */
function hhmmssToSeconds(timeString) {
  if (typeof timeString !== 'string') {
    console.warn(`⚠️ Invalid time string: ${timeString}, returning 0`);
    return 0;
  }

  const parts = timeString.split(':');
  if (parts.length !== 3) {
    console.warn(`⚠️ Invalid time format: ${timeString}, expected HH:MM:SS`);
    return 0;
  }

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    console.warn(`⚠️ Invalid time components in: ${timeString}`);
    return 0;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Ensure logging_interval_format is set based on logging_interval
 * @param {object} settings - Device settings object
 * @returns {object} Settings with both logging_interval and logging_interval_format
 */
function ensureLoggingIntervalFormat(settings) {
  if (!settings) return settings;

  // If logging_interval is a number but logging_interval_format is missing, convert it
  if (
    typeof settings.logging_interval === 'number' &&
    (!settings.logging_interval_format || settings.logging_interval_format === '')
  ) {
    settings.logging_interval_format = secondsToHHMMSS(settings.logging_interval);
    console.log(`🔄 Converted logging_interval ${settings.logging_interval}s to ${settings.logging_interval_format}`);
  }

  // If logging_interval_format exists but logging_interval is missing, convert it
  if (
    typeof settings.logging_interval_format === 'string' &&
    (typeof settings.logging_interval !== 'number' || settings.logging_interval === 0)
  ) {
    settings.logging_interval = hhmmssToSeconds(settings.logging_interval_format);
    console.log(`🔄 Converted logging_interval_format ${settings.logging_interval_format} to ${settings.logging_interval}s`);
  }

  return settings;
}

module.exports = {
  secondsToHHMMSS,
  hhmmssToSeconds,
  ensureLoggingIntervalFormat
};
