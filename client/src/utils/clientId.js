const CLIENT_ID_STORAGE_KEY = "watermark_client_id";

function generateClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getClientId() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "server-render";
  }

  let clientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (!clientId) {
    clientId = generateClientId();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  }

  return clientId;
}
