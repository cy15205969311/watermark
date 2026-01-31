<template>
  <el-card class="history-item" shadow="hover">
    <!-- 复选框 -->
    <div class="item-checkbox">
      <el-checkbox :model-value="selected" @change="$emit('update:selected', $event)" size="large" />
    </div>
    <!-- 头部信息 -->
    <div class="item-header">
      <div class="url-info">
        <a :href="record.originalUrl" target="_blank" class="url-link">
          {{ record.originalUrl }}
        </a>
        <el-tag :type="record.status === 'success' ? 'success' : 'info'" size="small">
          {{ record.status === 'success' ? '成功' : '已过期' }}
        </el-tag>
      </div>
      <span class="timestamp">{{ formatTime(record.timestamp) }}</span>
    </div>

    <!-- 缩略图 -->
    <div class="thumbnail-container">
      <div v-if="isExpired" class="expired-overlay">
        <div class="expired-badge">已过期</div>
        <img :src="record.thumbnailUrl" alt="Thumbnail" class="thumbnail blurred" />
      </div>
      <img v-else :src="record.thumbnailUrl" alt="Preview" class="thumbnail" />
    </div>

    <!-- 操作按钮 -->
    <div class="item-actions">
      <div class="action-buttons">
        <el-button type="success" plain size="small" @click="$emit('view-result', record)">
          <el-icon>
            <Picture />
          </el-icon>
          查看结果
        </el-button>

        <el-button v-if="!isExpired" type="primary" plain size="small" @click="$emit('open-download', record)">
          <el-icon>
            <Download />
          </el-icon>
          下载
        </el-button>

        <el-button type="danger" plain size="small" @click="handleDelete">
          <el-icon>
            <Delete />
          </el-icon>
          删除
        </el-button>
      </div>

      <el-tag v-if="isExpired" type="danger" size="small" effect="plain">
        <el-icon>
          <Clock />
        </el-icon>
        下载已过期，请重新解析下载
      </el-tag>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from 'vuex'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Picture, Download, Clock, Delete } from '@element-plus/icons-vue'

const store = useStore()

const props = defineProps({
  record: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  }
})

defineEmits(['update:selected', 'view-result', 'open-download'])

const isExpired = computed(() => props.record.status === 'expired')

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', { hour12: false })
}

const handleDownload = () => {
  const url = props.record.thumbnailUrl
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.download = `download-${props.record.id}.jpg`
  document.body.appendChild(link)
  link.click()
  setTimeout(() => { if (link.parentNode) link.parentNode.removeChild(link) }, 0)
  if (!url.startsWith('data:') && !/blob:/.test(url)) {
    window.open(url, '_blank', 'noopener')
  }
}

const handleDelete = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这条记录吗？',
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    await store.dispatch('deleteRecord', props.record.id)
    ElMessage.success('删除成功')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}
</script>

<style scoped>
.history-item {
  position: relative;
  transition: all 0.3s;
}

.history-item:hover {
  transform: translateY(-2px);
}

.item-checkbox {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  margin-left: 40px;
  gap: 12px;
}

.url-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.url-link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.url-link:hover {
  color: #2563eb;
  text-decoration: underline;
}

.timestamp {
  color: #94a3b8;
  font-size: 12px;
  white-space: nowrap;
}

.thumbnail-container {
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  background: #f9fafb;
}

.thumbnail {
  width: 100%;
  height: 200px;
  object-fit: cover;
  display: block;
}

.expired-overlay {
  position: relative;
}

.expired-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-12deg);
  font-size: 32px;
  font-weight: 700;
  color: #94a3b8;
  border: 4px solid #94a3b8;
  padding: 8px 16px;
  border-radius: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
}

.blurred {
  filter: blur(4px);
  opacity: 0.5;
}

.item-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .action-buttons {
    width: 100%;
  }

  .action-buttons .el-button {
    flex: 1;
    min-width: 80px;
  }
}
</style>
