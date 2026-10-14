// Keep the existing server driver, pool options and environment contract.
function createDatabase(config) {
  return require('mysql2/promise').createPool({
    ...config, waitForConnections: true, connectionLimit: 10, queueLimit: 0,
  });
}
module.exports = { createDatabase };
