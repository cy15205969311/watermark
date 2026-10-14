import { buildApiUrl } from "./api";

const IMAGE_PROXY_PATH = buildApiUrl("/proxy-image");
const IMAGE_PROXY_ROUTE_PATTERN = /(^https?:\/\/[^/]+)?\/api\/proxy-image(?:[/?#]|$)/i;

function isProxyPath(url = "") {
  return (
    typeof url === "string" &&
    (url.startsWith(IMAGE_PROXY_PATH) || IMAGE_PROXY_ROUTE_PATTERN.test(url.trim()))
  );
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
  return hostname === "huabanimg.com" || hostname.endsWith(".huabanimg.com") || ["img.tuguaishou.com", "img.818ps.com", "cdn.818ps.com"].includes(hostname);
}

export function toClientImageUrl(url = "") {
  // Uploaded files survive a desktop restart with a new loopback port.
  if (typeof window !== 'undefined' && window.desktop?.apiBaseUrl && typeof url === 'string') {
    try {
      const old = new URL(url);
      if (['127.0.0.1', 'localhost'].includes(old.hostname) && old.pathname.startsWith('/uploads/')) {
        return `${new URL(window.desktop.apiBaseUrl).origin}${old.pathname}`;
      }
    } catch {}
  }
  if (!shouldUseImageProxy(url)) {
    return typeof url === "string" ? url.trim() : "";
  }

  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(url.trim())}`;
}
