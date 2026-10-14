import { createStore } from "vuex";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { toClientImageUrl } from "../utils/imageProxy";
import { getClientId } from "../utils/clientId";

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const clientId = getClientId();
  config.headers = config.headers || {};
  config.headers["X-Client-Id"] = clientId;

  if (config.method?.toLowerCase() === "get") {
    config.params = {
      ...(config.params || {}),
      clientId,
    };
  }

  return config;
});

function parseJsonField(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isBlockedPreviewAssetUrl(value) {
  if (typeof value !== "string") {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (/^data:image\//.test(normalized) || /^blob:/.test(normalized)) {
    return false;
  }

  if (/^https?:\/\/hm\.baidu\.com\/hm\.gif/.test(normalized)) return true;
  if (/googletagmanager|google-analytics|doubleclick|umeng|clarity/.test(normalized)) {
    return true;
  }
  if (/\/distheadless\/img\//.test(normalized)) return true;
  if (/full-screen|fullscreen|favicon|tracker|tracking|pixel/.test(normalized)) {
    return true;
  }

  return false;
}

function normalizeRecordStatus(status) {
  const normalized =
    typeof status === "string" ? status.trim().toLowerCase() : "";

  if (
    ["success", "expired", "processing", "preview_image", "preview_only"].includes(
      normalized
    )
  ) {
    return normalized;
  }

  return "success";
}

export function normalizeRecord(record = {}) {
  let details = {};
  try { details = JSON.parse(record.extraction_metadata_json || "{}"); } catch {}
  record = { ...details, ...record };
  const imageUrls = [];
  const seen = new Set();

  const addUrl = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const normalized = value.trim();
    if (!normalized || isBlockedPreviewAssetUrl(normalized) || seen.has(normalized)) {
      return;
    }

    const clientUrl = toClientImageUrl(normalized);
    seen.add(clientUrl);
    imageUrls.push(clientUrl);
  };

  if (record.isAnimated === true && record.animationUrl) addUrl(record.animationUrl);
  (record.imageUrls || []).forEach(addUrl);
  (record.images || []).forEach(addUrl);
  parseJsonField(record.image_urls_json).forEach(addUrl);
  const rawPages = Array.isArray(record.pages)
    ? record.pages
    : parseJsonField(record.pages_json);

  const pages = rawPages
    .map((page, index) => ({
      ...page,
      page: Number(page && page.page) || index + 1,
      imageUrl:
        typeof (page && page.imageUrl) === "string"
          ? toClientImageUrl(page.imageUrl.trim())
          : "",
    }))
    .filter((page) => Boolean(page.imageUrl) && !isBlockedPreviewAssetUrl(page.imageUrl));

  pages.sort((a, b) => a.page - b.page);
  pages.forEach((page) => addUrl(page.imageUrl));
  addUrl(record.imageUrl);
  if (!imageUrls.length) addUrl(record.thumbnailUrl || record.thumbnail_url);

  const preferredThumbnailUrl =
    !isBlockedPreviewAssetUrl(record.thumbnailUrl)
      ? toClientImageUrl(record.thumbnailUrl)
      : !isBlockedPreviewAssetUrl(record.thumbnail_url)
        ? toClientImageUrl(record.thumbnail_url)
        : pages[0]?.imageUrl || imageUrls[0] || "";

  const preferredImageUrl =
    !isBlockedPreviewAssetUrl(record.imageUrl)
      ? toClientImageUrl(record.imageUrl)
      : pages[0]?.imageUrl || imageUrls[0] || "";

  if (!pages.length) {
    imageUrls.forEach((imageUrl, index) => {
      pages.push({
        page: index + 1,
        imageUrl,
      });
    });
  }

  const pageCount =
    Number(record.pageCount || record.page_count) ||
    imageUrls.length ||
    pages.length ||
    0;

  const isMultiPage =
    typeof record.isMultiPage === "boolean"
      ? record.isMultiPage
      : typeof record.is_multi_page === "boolean"
        ? record.is_multi_page
        : Number(record.is_multi_page || 0) === 1 || pageCount > 1;

  return {
    ...pickExtractionDetails(record),
    animationUrl: record.animationUrl ? toClientImageUrl(record.animationUrl) : null,
    id: record.id,
    originalUrl: record.originalUrl || record.original_url || "",
    platform: record.platform || "Unknown",
    thumbnailUrl: preferredThumbnailUrl,
    imageUrl: preferredImageUrl,
    imageUrls,
    pages,
    pageCount,
    isMultiPage,
    textLayers: record.textLayers || record.text_layers || [],
    status: normalizeRecordStatus(record.status),
    timestamp: record.timestamp || record.created_at || new Date().toISOString(),
  };
}

export function pickExtractionDetails(result = {}) {
  const fields = ["source", "metadata", "expectedPageCount", "collectedPageCount", "pageCountConfidence", "completenessStatus", "isComplete", "missingPages", "warnings", "mediaType", "detectedFormat", "isAnimated", "frameCount", "durationMs", "loopCount", "animationUrl", "animationStatus", "resourceRole", "originalResourceStatus", "downloadStatus", "hasVisibleWatermark", "selectionReason"];
  return Object.fromEntries(fields.filter(key => result[key] !== undefined).map(key => [key, result[key]]));
}

export default createStore({
  state: {
    history: [],
    loading: false,
    error: null,
  },

  mutations: {
    SET_HISTORY(state, history) {
      state.history = history;
    },
    ADD_RECORD(state, record) {
      state.history.unshift(record);
    },
    SET_LOADING(state, loading) {
      state.loading = loading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    REMOVE_RECORD(state, id) {
      state.history = state.history.filter((r) => r.id !== id);
    },
  },

  actions: {
    async fetchHistory({ commit, state }) {
      const initialIds = new Set(state.history.map(record => record.id));
      try {
        const { data } = await api.get("/history");
        if (data.success) {
          const fetched = (data.data || []).map(record => normalizeRecord(record));
          const fetchedIds = new Set(fetched.map(record => record.id));
          // Background history can finish after a new parse has been saved.
          const addedDuringFetch = state.history.filter(record => !initialIds.has(record.id) && !fetchedIds.has(record.id));
          commit(
            "SET_HISTORY",
            [...addedDuringFetch, ...fetched]
          );
        }
      } catch (error) {
        console.error("获取历史记录失败:", error);
        commit("SET_ERROR", error.message);
      }
    },

    async parseUrl(
      { commit },
      input
    ) {
      try {
        // App owns loading across extraction AND saving. This action must not
        // release that lock before the full user operation has finished.
        commit("SET_ERROR", null);

        const { url, platform, thumbnailUrl, imageUrl, imageUrls, pages, pageCount, isMultiPage, status } = input;
        const { data } = await api.post("/parse", {
          ...pickExtractionDetails(input),
          url,
          platform,
          thumbnailUrl,
          imageUrl,
          imageUrls,
          pages,
          pageCount,
          isMultiPage,
          status: normalizeRecordStatus(status),
          clientId: getClientId(),
        }, { timeout: 30000 });

        if (!data?.success || !data.data || typeof data.data !== "object" || Array.isArray(data.data)) {
          throw new Error(data?.message || "保存解析记录失败，请重试");
        }
        const frontendRec = normalizeRecord(data.data);
        commit("ADD_RECORD", frontendRec);
        return frontendRec;
      } catch (error) {
        commit("SET_ERROR", error.response?.data?.message || "解析失败");
        throw error;
      }
    },

    async deleteRecord({ commit }, id) {
      try {
        await api.delete(`/history/${id}`);
        commit("REMOVE_RECORD", id);
      } catch (error) {
        commit("SET_ERROR", "删除失败");
      }
    },
  },

  getters: {
    filteredHistory: (state) => (query) => {
      if (!query) return state.history;
      const q = query.toLowerCase();
      return state.history.filter(
        (r) =>
          r.originalUrl.toLowerCase().includes(q) ||
          r.platform.toLowerCase().includes(q)
      );
    },
  },
});
