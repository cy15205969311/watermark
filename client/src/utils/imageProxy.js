const IMAGE_PROXY_PATH = "/api/proxy-image";

function isProxyPath(url = "") {
  return typeof url === "string" && url.startsWith(IMAGE_PROXY_PATH);
}

function getHostname(url = "") {
  try {
    return String(new URL(url).hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

export function shouldUseImageProxy(url = "") {
  if (typeof url !== "string") {
    return false;
  }

  const normalized = url.trim();
  if (!normalized || isProxyPath(normalized)) {
    return false;
  }

  if (/^data:image\//i.test(normalized) || /^blob:/i.test(normalized)) {
    return false;
  }

  const hostname = getHostname(normalized);
  return hostname === "huabanimg.com" || hostname.endsWith(".huabanimg.com");
}

export function toClientImageUrl(url = "") {
  if (!shouldUseImageProxy(url)) {
    return typeof url === "string" ? url.trim() : "";
  }

  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(url.trim())}`;
}
