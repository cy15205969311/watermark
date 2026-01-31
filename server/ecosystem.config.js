module.exports = {
  apps: [{
    name: 'watermark-remover',
    script: 'index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/pm2/watermark-remover.log',
    error_file: '/var/log/pm2/watermark-remover-error.log',
    out_file: '/var/log/pm2/watermark-remover-out.log',
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs'],
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
}