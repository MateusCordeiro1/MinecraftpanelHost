module.exports = {
  apps : [{
    name   : "minecraft-panel",
    script : "server.js",
    watch  : false,
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G'
  }]
}
