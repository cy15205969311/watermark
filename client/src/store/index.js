import { createStore } from "vuex";
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
});

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
          // 转换数据库字段名为前端期望的格式
          const formattedData = data.data.map((record) => ({
            id: record.id,
            originalUrl: record.original_url,
            platform: record.platform,
            thumbnailUrl: record.thumbnail_url,
            // 如果后端提供了 textLayers，则保留到前端历史记录中
            textLayers: record.text_layers || [],
            status: record.status,
            timestamp: record.created_at,
          }));
          commit("SET_HISTORY", formattedData);
        }
      } catch (error) {
        console.error("获取历史记录失败:", error);
        commit("SET_ERROR", error.message);
      } finally {
        commit("SET_LOADING", false);
      }
    },

    async parseUrl({ commit }, { url, platform, thumbnailUrl }) {
      try {
        commit("SET_LOADING", true);
        commit("SET_ERROR", null);

        const { data } = await api.post("/parse", {
          url,
          platform,
          thumbnailUrl,
          status: "success",
        });

        if (data.success) {
          // 后端 parse 接口应返回 data.data 为新创建的记录对象
          const rec = data.data;
          // 保证兼容：把可能的 textLayers 规范到前端字段
          const frontendRec = {
            id: rec.id,
            originalUrl: rec.original_url || url,
            platform: rec.platform || platform,
            thumbnailUrl: rec.thumbnail_url || thumbnailUrl,
            textLayers: rec.text_layers || [],
            status: rec.status || "success",
            timestamp: rec.created_at || new Date().toISOString(),
          };
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
