import { createStore } from "vuex";
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
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

function normalizeRecord(record = {}) {
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

    seen.add(normalized);
    imageUrls.push(normalized);
  };

  (record.imageUrls || []).forEach(addUrl);
  (record.images || []).forEach(addUrl);
  parseJsonField(record.image_urls_json).forEach(addUrl);
  const rawPages = Array.isArray(record.pages)
    ? record.pages
    : parseJsonField(record.pages_json);

  const pages = rawPages
    .map((page, index) => ({
      page: Number(page && page.page) || index + 1,
      imageUrl:
        typeof (page && page.imageUrl) === "string"
          ? page.imageUrl.trim()
          : "",
    }))
    .filter((page) => Boolean(page.imageUrl) && !isBlockedPreviewAssetUrl(page.imageUrl));

  pages.forEach((page) => addUrl(page.imageUrl));
  addUrl(record.imageUrl);
  addUrl(record.thumbnailUrl || record.thumbnail_url);

  const preferredThumbnailUrl =
    !isBlockedPreviewAssetUrl(record.thumbnailUrl)
      ? record.thumbnailUrl
      : !isBlockedPreviewAssetUrl(record.thumbnail_url)
        ? record.thumbnail_url
        : pages[0]?.imageUrl || imageUrls[0] || "";

  const preferredImageUrl =
    !isBlockedPreviewAssetUrl(record.imageUrl)
      ? record.imageUrl
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
    status: record.status || "success",
    timestamp: record.timestamp || record.created_at || new Date().toISOString(),
  };
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
    async fetchHistory({ commit }) {
      try {
        commit("SET_LOADING", true);
        const { data } = await api.get("/history");
        if (data.success) {
          commit(
            "SET_HISTORY",
            (data.data || []).map((record) => normalizeRecord(record))
          );
        }
      } catch (error) {
        console.error("获取历史记录失败:", error);
        commit("SET_ERROR", error.message);
      } finally {
        commit("SET_LOADING", false);
      }
    },

    async parseUrl(
      { commit },
      { url, platform, thumbnailUrl, imageUrl, imageUrls, pages, pageCount, isMultiPage }
    ) {
      try {
        commit("SET_LOADING", true);
        commit("SET_ERROR", null);

        const { data } = await api.post("/parse", {
          url,
          platform,
          thumbnailUrl,
          imageUrl,
          imageUrls,
          pages,
          pageCount,
          isMultiPage,
          status: "success",
        });

        if (data.success) {
          const frontendRec = normalizeRecord(data.data);
          commit("ADD_RECORD", frontendRec);
          return frontendRec;
        }
      } catch (error) {
        commit("SET_ERROR", error.response?.data?.message || "解析失败");
        throw error;
      } finally {
        commit("SET_LOADING", false);
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
