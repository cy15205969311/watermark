// Explicit process-local configuration. Server imports remain MySQL by default.
let configuration = Object.freeze({ mode: 'server', database: 'mysql' });
let configured = false;
function configureDesktop(options) {
  if (configured || require.cache[require.resolve('./index')]) throw new Error('Runtime already initialized');
  if (!options?.dataDirectory || !options.databasePath || !options.guard) throw new Error('Incomplete desktop runtime');
  configuration = Object.freeze({ ...options, mode: 'desktop', database: 'sqlite' });
  configured = true;
}
module.exports = { configureDesktop, getRuntime: () => configuration };
