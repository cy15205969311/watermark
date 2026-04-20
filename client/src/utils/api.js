function normalizeApiBaseUrl(value) {
  if (typeof value !== "string") {
    return "/api";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "/api";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsedUrl = new URL(trimmed);
      const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
      const pathname = !normalizedPath || normalizedPath === "/" ? "/api" : normalizedPath;
      return `${parsedUrl.origin}${pathname}`;
    } catch {
      return trimmed.replace(/\/+$/, "");
    }
  }

  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const sanitizedPath = normalizedPath.replace(/\/+$/, "");
  return sanitizedPath === "/" ? "/api" : sanitizedPath;
}

export const API_BASE_URL = normalizeApiBaseUrl(
  typeof import.meta !== "undefined" ? import.meta.env.VITE_API_BASE_URL : ""
);

export function buildApiUrl(path = "") {
  if (typeof path !== "string") {
    return API_BASE_URL;
  }

  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return API_BASE_URL;
  }

  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.startsWith("/")
    ? trimmedPath
    : `/${trimmedPath}`;

  return `${API_BASE_URL}${normalizedPath}`;
}
