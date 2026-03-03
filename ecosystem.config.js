module.exports = {
  apps: [{
    name: 'zeptac-backend',
    script: './index.js',
    instances: 'max',
    exec_mode: 'cluster',
    
    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    
    // Logging configuration
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Auto-restart settings
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Memory management
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=4096',
    
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // Development mode settings (when NODE_ENV=development)
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001
    }
  }]
};
