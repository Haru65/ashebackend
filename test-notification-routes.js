const notificationRoutes = require('./routes/notificationRoutes');

console.log('Notification Routes Registered:');
console.log('================================\n');

const routes = notificationRoutes.stack
  .filter(layer => layer.route)
  .map(layer => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods).map(m => m.toUpperCase())
  }));

routes.forEach(r => {
  const methods = r.methods.join(', ').padEnd(20);
  console.log(`${methods} ${r.path}`);
});

console.log('\n================================');
console.log(`Total routes: ${routes.length}`);

// Check for read-specific routes
const readRoutes = routes.filter(r => r.path.includes('read'));
console.log(`\nRoutes with 'read': ${readRoutes.length} found`);
readRoutes.forEach(r => {
  console.log(`  ${r.methods.join(', ').padEnd(20)} ${r.path}`);
});

// Check for OPTIONS support on read endpoint
const optionsReadRoute = routes.find(r => r.path === '/:notificationId/read' && r.methods.includes('OPTIONS'));
if (optionsReadRoute) {
  console.log('\n✅ OPTIONS handler found for /:notificationId/read');
} else {
  console.log('\n❌ NO OPTIONS handler found for /:notificationId/read');
}
