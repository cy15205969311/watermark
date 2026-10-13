function getPuppeteerExecutablePath() {
  const executablePath = String(
    process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();

  return executablePath || undefined;
}

function withPuppeteerExecutablePath(launchOptions = {}) {
  const normalizedLaunchOptions = { ...launchOptions };
  const explicitExecutablePath = String(
    normalizedLaunchOptions.executablePath || ""
  ).trim();

  if (explicitExecutablePath) {
    normalizedLaunchOptions.executablePath = explicitExecutablePath;
    return normalizedLaunchOptions;
  }

  const executablePath = getPuppeteerExecutablePath();
  if (executablePath) {
    normalizedLaunchOptions.executablePath = executablePath;
  }

  return normalizedLaunchOptions;
}

module.exports = {
  getPuppeteerExecutablePath,
  withPuppeteerExecutablePath,
};
