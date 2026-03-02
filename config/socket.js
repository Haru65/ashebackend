const socketIo = require('socket.io');

const initializeSocket = (server) => {
  // Determine allowed origins based on environment
  // In production WITHOUT FRONTEND_URL set, allow all origins as fallback
  // To restrict in production, SET FRONTEND_URL environment variable
  const corsOrigin = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL 
    : true; // Allow all origins if FRONTEND_URL not set

  console.log('[Socket.IO] CORS Configuration:');
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set (allowing all origins)');
  console.log('   CORS Origin Policy:', corsOrigin === true ? 'Accept ALL origins' : `Restrict to: ${corsOrigin}`);

  const io = socketIo(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    },
    transports: ['websocket', 'polling'], // Support both transports
    pingInterval: 25000,
    pingTimeout: 20000
  });

  return io;
};

module.exports = { initializeSocket };