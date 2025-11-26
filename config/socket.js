const socketIo = require('socket.io');

const initializeSocket = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: true, // Allow all origins for development
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