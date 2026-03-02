// Test coordinate conversion precision

// DMS: 19°03'N, 072°52'E
// Current conversion: 19.05, 72.8667

// Let's check what Sion East coordinates should be
const testCoordinates = [
  { name: 'Sion East (stored)', lat: 19.076, lon: 72.8777 },
  { name: 'Currey Road (converted)', lat: 19.05, lon: 72.8667 },
  { name: 'DMS 19°03\'N', lat: 19 + (3/60), lon: null },
  { name: 'DMS 072°52\'E', lat: null, lon: 72 + (52/60) },
];

console.log('Coordinate Analysis:');
console.log('='.repeat(60));

testCoordinates.forEach(coord => {
  if (coord.lat !== null && coord.lon !== null) {
    console.log(`\n${coord.name}:`);
    console.log(`  Lat: ${coord.lat}`);
    console.log(`  Lon: ${coord.lon}`);
  } else if (coord.lat !== null) {
    console.log(`\n${coord.name}:`);
    console.log(`  Lat: ${coord.lat} (19 + 3/60 = ${19 + (3/60)})`);
  } else if (coord.lon !== null) {
    console.log(`\n${coord.name}:`);
    console.log(`  Lon: ${coord.lon} (72 + 52/60 = ${72 + (52/60)})`);
  }
});

console.log('\n' + '='.repeat(60));
console.log('Analysis:');
console.log('- Sion East stored: 19.076, 72.8777');
console.log('- DMS converted: 19.05, 72.8667');
console.log('- Difference: ~0.026 lat, ~0.011 lon');
console.log('\nThe DMS conversion is CORRECT mathematically.');
console.log('The issue is that the device is sending DIFFERENT coordinates');
console.log('than what was originally stored for Sion East.');
console.log('\nOptions:');
console.log('1. Use raw DMS for geocoding (but API needs decimal)');
console.log('2. Store the correct Sion East coordinates in Device model');
console.log('3. Use a location mapping/cache for known DMS coordinates');
