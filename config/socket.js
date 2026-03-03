const socketIo = require('socket.io');

const initializeSocket = (server) => {
  // Parse multiple frontend URLs from environment variable
  const frontendUrls = process.env.FRONTEND_URLS 
    ? process.env.FRONTEND_URLS.split(',').map(url => url.trim())
    : [];
  
  const singleFrontendUrl = process.env.FRONTEND_URL;
  
  // Build allowed origins list
  let allowedOrigins = [];
  
  if (frontendUrls.length > 0) {
    allowedOrigins = frontendUrls;
  } else if (singleFrontendUrl) {
    allowedOrigins = [singleFrontendUrl];
  } else {
    // Fallback: allow all origins if no URLs configured
    // This is less secure but necessary for development
    allowedOrigins = true;
  }

  console.log('[Socket.IO] CORS Configuration:');
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   FRONTEND_URLS:', process.env.FRONTEND_URLS || 'Not set');
  console.log('   FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
  console.log('   Allowed Origins:', Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : 'ALL (permissive mode)');

  const io = socketIo(server, {
    cors: {
      origin: allowedOrigins === true ? '*' : allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: allowedOrigins === true ? false : true,
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 200
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    allowEIO3: true,
    maxHttpBufferSize: 1e6
  });

  // Log connection events
  io.on('connection', (socket) => {
    console.log(`✅ [Socket.IO] Client connected: ${socket.id}`);
    
    socket.on('disconnect', (reason) => {
      console.log(`❌ [Socket.IO] Client disconnected: ${socket.id} (reason: ${reason})`);
    });

    socket.on('error', (error) => {
      console.error(`❌ [Socket.IO] Socket error for ${socket.id}:`, error);
    });
  });

  return io;
};

module.exports = { initializeSocket };