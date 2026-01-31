<template>
  <div class="app-container">
    <!-- 头部 -->
    <header class="header">
      <div class="header-content">
        <div class="logo">
          <el-icon :size="28" color="#10b981">
            <Grid />
          </el-icon>
          <h1>去水印<span>下载助手</span></h1>
        </div>
      </div>

      <!-- 全局下载对话框 -->
      <DownloadDialog :model-value="downloadDialogVisible" :record="downloadRecord"
        @update:modelValue="val => downloadDialogVisible = val" @download="handleDownloadEvent" />

      <!-- 图片预览对话框 -->
      <el-dialog v-model="previewDialogVisible" title="查看结果" width="550px" :close-on-click-modal="true">
        <div class="preview-container">
          <el-image :src="previewImageUrl" fit="contain" :preview-src-list="[previewImageUrl]" :initial-index="0"
            class="preview-image">
            <template #error>
              <div class="image-error">
                <el-icon :size="50">
                  <Picture />
                </el-icon>
                <p>图片加载失败</p>
              </div>
            </template>
          </el-image>
        </div>
        <div v-if="previewTextLayers && previewTextLayers.length > 0" class="textlayers-panel">
          <h4>识别到的文本层 ({{ previewTextLayers.length }})</h4>
          <div class="textlayers-list">
            <div v-for="(t, idx) in previewTextLayers" :key="idx" class="textlayer-item">
              <div class="textlayer-text">{{ t.text }}</div>
              <div class="textlayer-meta">{{ t.tag }} • {{ t.fontSize }} • {{ t.color }}</div>
            </div>
          </div>
        </div>
      </el-dialog>
    </header>

    <main class="main-content">
      <!-- 主卡片 -->
      <el-card class="main-card">
        <!-- VIP 状态 -->
        <div class="vip-section">
          <div class="vip-header">
            <h2>卡密信息</h2>
            <el-icon class="refresh-icon">
              <Refresh />
            </el-icon>
          </div>
          <div class="vip-status">
            <el-icon :size="32" color="#10b981">
              <Connection />
            </el-icon>
            <span>VIP 无限次使用</span>
          </div>
          <div class="vip-info">
            <p>剩余次数：<span class="unlimited">无限</span></p>
            <p class="vip-desc">当前为至尊VIP版，支持全网解析，无任何限制。</p>
          </div>

          <!-- 支持平台 -->
          <PlatformIcons />
        </div>

        <!-- 输入表单 -->
        <div class="input-section">
          <el-input v-model="inputUrl" type="textarea" :rows="4"
            placeholder="请粘贴分享链接，例如：https://v.douyin.com/... 或 抖音搜索..." class="url-input" />

          <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="error-alert" />

          <div class="button-group">
            <el-button type="success" size="large" :loading="loading" @click="handleParse" class="parse-btn">
              <el-icon>
                <Search />
              </el-icon>
              {{ loading ? '智能解析中...' : '解析链接' }}
            </el-button>

            <el-button type="primary" size="large" class="upload-btn" @click="openUploadDialog">
              <el-icon>
                <Picture />
              </el-icon>
              本地去水印
            </el-button>

            <el-button type="warning" size="large" class="help-btn" @click="openHelp">
              <el-icon>
                <QuestionFilled />
              </el-icon>
              使用教程
            </el-button>
          </div>

          <!-- 本地上传去水印对话框 -->
          <el-dialog v-model="uploadDialogVisible" title="本地图片去水印" width="520px" :close-on-click-modal="false">
            <div class="upload-dialog-body">
              <el-upload class="upload-block" drag :auto-upload="false" :show-file-list="false" accept="image/*"
                @change="handleFileChange">
                <el-icon class="el-icon--upload">
                  <Picture />
                </el-icon>
                <div class="el-upload__text">
                  拖拽图片到此或 <em>点击选择</em>
                </div>
                <template #tip>
                  <div class="el-upload__tip">支持 PNG/JPG/WebP，最大 10MB</div>
                </template>
              </el-upload>
              <div v-if="uploadPreview" class="local-preview">
                <img :src="uploadPreview" alt="preview" />
              </div>

              <!-- 算法选择 -->
              <div v-if="uploadFile" class="algorithm-selector">
                <div class="selector-label">选择去水印算法:</div>
                <el-radio-group v-model="selectedAlgorithm" size="small">
                  <el-radio-button value="default">
                    <el-tooltip content="终极Hybrid方案：智能区域检测+方向性去除+多尺度处理+纹理修复，90%接近PS效果" placement="top">
                      <span>🌟 Hybrid（推荐）</span>
                    </el-tooltip>
                  </el-radio-button>
                  <el-radio-button value="fast">
                    <el-tooltip content="速度最快，适合轻度水印" placement="top">
                      <span>⚡ 快速模式</span>
                    </el-tooltip>
                  </el-radio-button>
                  <el-radio-button value="advanced">
                    <el-tooltip content="边缘检测，适合复杂水印" placement="top">
                      <span>🧠 高级模式</span>
                    </el-tooltip>
                  </el-radio-button>
                </el-radio-group>
              </div>

              <div class="upload-actions">
                <el-button @click="uploadDialogVisible = false">取消</el-button>
                <el-button type="primary" :disabled="!uploadFile || uploading" :loading="uploading"
                  @click="submitUpload">
                  {{ uploading ? '处理中...' : '开始去水印' }}
                </el-button>
              </div>
            </div>
          </el-dialog>
        </div>
      </el-card>

      <!-- 使用教程弹窗 -->
      <el-dialog v-model="showHelp" :width="helpWidth" :close-on-click-modal="false" title="使用教程">
        <div class="tutorial-container">
          <div class="tutorial-left">
            <h3>第 {{ currentStep + 1 }} 步 / {{ steps.length }}：{{ steps[currentStep].title }}</h3>
            <p v-html="steps[currentStep].desc"></p>
            <div class="tutorial-controls">
              <el-button size="small" @click="prevStep" :disabled="currentStep === 0">上一步</el-button>
              <el-button size="small" @click="nextStep" :disabled="currentStep === steps.length - 1">下一步</el-button>
              <el-button type="primary" size="small" @click="closeHelp">我知道了</el-button>
            </div>
          </div>
          <div class="tutorial-right">
            <div class="tutorial-image-wrap">
              <img :src="steps[currentStep].image || placeholderImage" alt="教程截图" />
            </div>
            <!-- <div class=" tutorial-note">提示：如果要替换截图，请把图片放到 `client/public/tutorial/` 目录并以 `step-1.png` 等命名。
            </div> -->
          </div>
        </div>
      </el-dialog>

      <!-- 搜索栏 -->
      <el-input v-if="history.length > 0" v-model="searchQuery" placeholder="搜索历史记录..." prefix-icon="Search"
        class="search-input" />

      <!-- 历史记录标题 -->
      <div class="history-header">
        <div class="header-left">
          <h3>使用记录</h3>
          <el-tag type="info">{{ filteredHistory.length }} 条记录</el-tag>
          <el-tag v-if="selectedRecords.size > 0" type="primary">已选择 {{ selectedRecords.size }} 项</el-tag>
        </div>
        <div class="header-right" v-if="selectedRecords.size > 0">
          <el-button type="primary" size="small" @click="batchDownload">
            <el-icon>
              <Download />
            </el-icon>
            批量下载
          </el-button>
          <el-button type="danger" size="small" @click="batchDelete" :loading="batchDeleting" :disabled="batchDeleting">
            <el-icon>
              <Delete />
            </el-icon>
            批量删除
          </el-button>
          <el-button size="small" @click="clearSelection">取消选择</el-button>
        </div>
      </div>

      <!-- 历史记录列表 -->
      <div class="history-list">
        <el-empty v-if="filteredHistory.length === 0" :description="searchQuery ? '没有找到匹配的记录' : '暂无解析记录'" />

        <HistoryItem v-for="record in pagedHistory" :key="record.id" :record="record" :selected="isSelected(record.id)"
          @update:selected="(val) => toggleSelection(record.id, val)" @open-download="openDownload"
          @view-result="viewResult" />
      </div>

      <!-- 分页 -->
      <el-pagination v-if="filteredHistory.length > 0" class="history-pagination" background
        layout="prev, pager, next, total" :total="filteredHistory.length" :current-page="currentPage"
        :page-size="pageSize" @current-change="(p) => currentPage = p" />

      <!-- 底部提示 -->
      <div class="footer-tip">
        第一次使用必看，详细教您如何获取无水印图片
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useStore } from 'vuex'
import { Grid, Refresh, Connection, Search, QuestionFilled, Picture, Download, Delete } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import HistoryItem from './components/HistoryItem.vue'
import PlatformIcons from './components/PlatformIcons.vue'
import DownloadDialog from './components/DownloadDialog.vue'

const store = useStore()

const inputUrl = ref('')
const searchQuery = ref('')

const loading = computed(() => store.state.loading)
const error = computed(() => store.state.error)
const history = computed(() => store.state.history)
const filteredHistory = computed(() => store.getters.filteredHistory(searchQuery.value))
// 分页：每页10条
const currentPage = ref(1)
const pageSize = ref(10)
const pagedHistory = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredHistory.value.slice(start, start + pageSize.value)
})

onMounted(() => {
  store.dispatch('fetchHistory')
})

// 下载对话框状态
const downloadDialogVisible = ref(false)
const downloadRecord = ref(null)

// 图片预览对话框状态
const previewDialogVisible = ref(false)
const previewImageUrl = ref('')
const previewTextLayers = ref([])

// 批量选择状态
const selectedRecords = ref(new Set())

function toggleSelection(recordId, selected) {
  if (selected) {
    selectedRecords.value.add(recordId)
  } else {
    selectedRecords.value.delete(recordId)
  }
}

function isSelected(recordId) {
  return selectedRecords.value.has(recordId)
}

function openDownload(record) {
  console.log('打开下载对话框', record)
  downloadRecord.value = record
  downloadDialogVisible.value = true
}

function viewResult(record) {
  console.log('查看结果', record)
  previewImageUrl.value = record.thumbnailUrl || record.imageUrl || ''
  previewTextLayers.value = record.textLayers || []
  previewDialogVisible.value = true
}

function clearSelection() {
  selectedRecords.value.clear()
}

async function batchDownload() {
  const selected = Array.from(selectedRecords.value)
  if (selected.length === 0) return

  for (const id of selected) {
    const record = history.value.find(r => r.id === id)
    if (record && record.thumbnailUrl) {
      const link = document.createElement('a')
      link.href = record.thumbnailUrl
      link.download = `image-${record.id}.jpg`
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  clearSelection()
}

// 批量删除状态与逻辑
const batchDeleting = ref(false)
async function batchDelete() {
  if (batchDeleting.value) return
  const ids = Array.from(selectedRecords.value)
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确定要批量删除选中的 ${ids.length} 条记录吗？`,
      '批量删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch (e) {
    return
  }
  batchDeleting.value = true
  let success = 0
  let fail = 0
  const failedIds = []
  await Promise.all(ids.map(async id => {
    try {
      await store.dispatch('deleteRecord', id)
      success++
    } catch (err) {
      fail++
      failedIds.push(id)
    }
  }))
  if (fail === 0) {
    ElMessage.success(`已成功删除 ${success} 条记录`)
    clearSelection()
  } else {
    ElMessage.error(`删除完成：成功 ${success} 条，失败 ${fail} 条`)
    selectedRecords.value = new Set(failedIds)
  }
  batchDeleting.value = false
}

async function handleDownloadEvent({ record, format, print }) {
  const url = record.thumbnailUrl
  try {
    const a = document.createElement('a')
    a.href = url
    const ext = format || 'png'
    a.download = `download-${record.id}.${ext}`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    // Safari 等可能不支持 download + _blank，做一次 window.open 兜底
    setTimeout(() => {
      if (!a.parentNode) return
      document.body.removeChild(a)
    }, 0)
    if (!url.startsWith('data:') && !/blob:/.test(url)) {
      // 尝试再打开一次新标签作为兜底（避免某些浏览器阻止）
      window.open(url, '_blank', 'noopener')
    }
  } catch (err) {
    console.error('下载失败', err)
  }
}

const handleParse = async () => {
  if (!inputUrl.value.trim()) {
    store.commit('SET_ERROR', '请输入有效的链接')
    return
  }

  try {
    let originalUrl = inputUrl.value.trim()

    // 规范化输入：尝试从文本中提取第一个 URL，如果没有协议则补 https://
    const urlMatch = originalUrl.match(/(https?:\/\/[^\s]+)|(www\.[^\s]+)/i)
    if (urlMatch) {
      originalUrl = urlMatch[0]
      if (!/^https?:\/\//i.test(originalUrl)) {
        originalUrl = 'https://' + originalUrl
      }
    }

    // 最后尝试使用 URL 构造器判定是否为有效 URL
    try {
      /* eslint-disable no-new */
      new URL(originalUrl)
    } catch (err) {
      store.commit('SET_ERROR', '请输入有效的链接（请包含 https:// 或 www.）')
      return
    }

    const url = originalUrl.toLowerCase()

    // 平台识别
    let platform = 'Unknown'
    if (url.includes('douyin')) platform = '抖音'
    else if (url.includes('kuaishou')) platform = '快手'
    else if (url.includes('xiaohongshu') || url.includes('xhs')) platform = '小红书'
    else if (url.includes('bilibili')) platform = 'Bilibili'
    else if (url.includes('youtube')) platform = 'YouTube'
    else if (url.includes('818ps')) platform = '818ps'
    else if (url.includes('canva')) platform = 'Canva'

    console.log('🚀 开始解析:', { url: originalUrl, platform })

    // 使用已确认的URL格式直接构建
    let thumbnailUrl = `https://picsum.photos/400/300?random=${Date.now()}`

    if (platform === '818ps') {
      try {
        // 直接从URL提取参数 - 支持多种 URL 格式
        const urlObj = new URL(originalUrl);
        let picId = urlObj.searchParams.get('picId');
        let upicId = urlObj.searchParams.get('upicId');

        // 如果直接参数中没有，尝试从路径中提取
        if (!picId && !upicId) {
          const pathMatch = originalUrl.match(/\/view\?([^?]*)/);
          if (pathMatch) {
            const params = new URLSearchParams(pathMatch[1]);
            picId = params.get('picId');
            upicId = params.get('upicId');
          }
        }

        console.log('📋 提取的参数:', { picId, upicId });

        if (picId && upicId) {
          // 使用已确认的正确格式（从用户截图验证）
          // 格式: https://img.818ps.com/pic/{upicId}/{picId}.jpg
          thumbnailUrl = `https://img.818ps.com/pic/${upicId}/${picId}.jpg`;
          console.log('✅ 使用已确认的图片URL:', thumbnailUrl);
        } else {
          console.warn('⚠️ 缺少必要参数 picId 或 upicId，将由后端提取');
        }
      } catch (error) {
        console.error('❌ 解析818ps链接失败:', error);
      }
    } else if (platform === 'Canva') {
      // Canva链接处理
      try {
        const designMatch = originalUrl.match(/design\/([^\/]+)/)
        if (designMatch) {
          const designId = designMatch[1]
          thumbnailUrl = `https://picsum.photos/seed/canva-${designId}/400/300`
          console.log('🎨 Canva设计ID:', designId)
        }
      } catch (error) {
        console.error('❌ 解析Canva链接失败:', error)
      }
    }

    // 智能策略：先尝试后端API，失败时使用占位图并显示警告
    console.log('🔄 调用后端API验证图片URL...')
    let useRealImage = false
    let warningMessage = null

    try {
      const response = await fetch('/api/extract-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: originalUrl, platform })
      })

      const data = await response.json()

      if (response.ok && data.success && data.imageUrl) {
        thumbnailUrl = data.imageUrl
        useRealImage = true
        console.log('✅ 后端验证成功，使用真实图片:', thumbnailUrl)
      } else {
        // 后端返回错误，使用占位图作为降级方案
        const errorMsg = data.message || '无法获取真实图片'
        console.warn('⚠️ 后端响应错误 (HTTP ' + response.status + '):', errorMsg)

        // 根据平台使用不同的占位图策略
        if (platform === '818ps' && thumbnailUrl.includes('img.818ps.com')) {
          // 818ps保持已构建的URL
          warningMessage = '⚠️ 后端无法验证图片: ' + errorMsg + '，使用预测的URL'
        } else {
          // 其他平台使用占位图
          thumbnailUrl = `https://picsum.photos/seed/${platform}-${Date.now()}/400/300`
          warningMessage = '⚠️ ' + errorMsg + '，已使用占位图'
        }
      }
    } catch (error) {
      console.error('❌ 后端API调用失败:', error.message)

      // 使用降级方案
      if (platform === '818ps' && thumbnailUrl.includes('img.818ps.com')) {
        // 818ps保持已构建的URL
        warningMessage = '⚠️ 网络错误，使用预测的URL'
      } else {
        // 其他平台使用占位图
        thumbnailUrl = `https://picsum.photos/seed/${platform}-${Date.now()}/400/300`
        warningMessage = '⚠️ 网络连接失败，已使用占位图'
      }
    }

    // 显示警告信息（如果有）
    if (warningMessage) {
      store.commit('SET_ERROR', warningMessage)
      // 3秒后自动清除警告
      setTimeout(() => {
        store.commit('SET_ERROR', null)
      }, 3000)
    }

    console.log('🎯 最终使用的图片URL:', thumbnailUrl)

    await store.dispatch('parseUrl', {
      url: originalUrl,
      platform,
      thumbnailUrl
    })

    inputUrl.value = ''
  } catch (err) {
    console.error('❌ 解析失败:', err)
    store.commit('SET_ERROR', err.message || '解析失败，请重试')
  }
}

// 使用教程对话框逻辑
const showHelp = ref(false)
const helpWidth = '90%'

const steps = reactive([
  {
    title: '在您的账号中做好图片，点击右上角分享',
    desc: '1. 在 Canva 中打开你的设计，点击页面右上角的 <strong>分享</strong> 按钮。',
    image: '/tutorial/step-1.png'
  },
  {
    title: '点击复制分享链接',
    desc: '2. 在弹出的分享面板中点击 <strong>复制分享链接</strong>，把链接复制到剪贴板。',
    image: '/tutorial/step-2.png'
  },
  {
    title: '回到助手粘贴链接并解析',
    desc: '3. 回到本助手，将复制的分享链接粘贴到输入框，然后点击 <strong>解析链接</strong>。',
    image: '/tutorial/step-3.png'
  },
  {
    title: '选择图片格式并下载',
    desc: '4. 在弹出的下载选项中选择需要的格式（PNG/JPG/PDF），确认后即可下载。',
    image: '/tutorial/step-4.png'
  }
])

const placeholderImage = '/tutorial/placeholder.png'
const currentStep = ref(0)

function openHelp() {
  console.log('打开使用教程弹窗')
  showHelp.value = true
}
function closeHelp() {
  showHelp.value = false
}
function nextStep() {
  if (currentStep.value < steps.length - 1) currentStep.value++
}
function prevStep() {
  if (currentStep.value > 0) currentStep.value--
}

// 本地上传去水印状态与逻辑
const uploadDialogVisible = ref(false)
const uploadFile = ref(null)
const uploadPreview = ref('')
const uploading = ref(false)
const selectedAlgorithm = ref('default')

function openUploadDialog() {
  uploadDialogVisible.value = true
  selectedAlgorithm.value = 'default' // 重置为默认算法
}

function handleFileChange(file) {
  // el-upload 触发 change 时传入 { file, files }，也可能直接传 file 对象
  const raw = file.raw || file
  if (!raw) return
  uploadFile.value = raw
  try { uploadPreview.value = URL.createObjectURL(raw) } catch { }
}

async function submitUpload() {
  if (!uploadFile.value) return
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('image', uploadFile.value)

    // 根据选择的算法添加 query 参数
    const queryParam = selectedAlgorithm.value !== 'default' ? `?method=${selectedAlgorithm.value}` : ''
    const resp = await fetch(`/api/upload-image${queryParam}`, { method: 'POST', body: fd })
    const data = await resp.json()

    if (resp.ok && data.success && data.imageUrl) {
      // 显示处理结果提示
      const methodName = {
        'combined': 'Hybrid方案',
        'fast': '快速模式',
        'advanced': '高级模式',
        'original': '原图（处理失败）'
      }[data.method] || '默认模式'

      store.commit('ADD_RECORD', {
        id: Date.now(),
        originalUrl: '本地上传:' + (uploadFile.value.name || 'image') + ` [${methodName}]`,
        platform: '本地',
        thumbnailUrl: data.imageUrl,
        status: 'success',
        timestamp: new Date().toISOString()
      })

      uploadDialogVisible.value = false
      uploadFile.value = null
      uploadPreview.value = ''

      // 显示成功提示
      if (data.method !== 'original') {
        store.commit('SET_ERROR', `✅ 使用 ${methodName} 处理完成`)
      } else {
        store.commit('SET_ERROR', '⚠️ 水印去除失败，已保存原图')
      }
      setTimeout(() => store.commit('SET_ERROR', null), 3000)
    } else {
      store.commit('SET_ERROR', data.message || '上传失败')
      setTimeout(() => store.commit('SET_ERROR', null), 3000)
    }
  } catch (e) {
    store.commit('SET_ERROR', e.message || '上传异常')
    setTimeout(() => store.commit('SET_ERROR', null), 3000)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background: #f3f4f6;
  padding-bottom: 40px;
}

.header {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 768px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  justify-content: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo h1 {
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.logo h1 span {
  color: #10b981;
}

.main-content {
  max-width: 768px;
  margin: 24px auto;
  padding: 0 16px;
}

.main-card {
  margin-bottom: 24px;
}

.vip-section {
  margin-bottom: 32px;
}

.vip-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.vip-header h2 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.refresh-icon {
  cursor: pointer;
  transition: transform 0.5s;
}

.refresh-icon:hover {
  transform: rotate(180deg);
}

.vip-status {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  color: #10b981;
  margin-bottom: 8px;
}

.vip-status span {
  font-size: 14px;
  font-weight: 500;
}

.vip-info p {
  font-size: 14px;
  color: #64748b;
  margin: 4px 0;
}

.unlimited {
  color: #10b981;
  font-weight: 700;
}

.vip-desc {
  font-size: 12px !important;
  color: #94a3b8 !important;
}

.input-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.url-input :deep(.el-textarea__inner) {
  border-radius: 12px;
  background: #f9fafb;
}

.error-alert {
  margin: 0;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.parse-btn,
.help-btn {
  width: 100%;
  border-radius: 12px;
  font-weight: 500;
}

/* 在较宽屏时将主要按钮水平排列 */
@media (min-width: 640px) {
  .button-group {
    flex-direction: row;
  }

  .parse-btn,
  .help-btn {
    width: 50%;
  }
}

.search-input {
  margin-bottom: 16px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 0 8px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-header h3 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.history-pagination {
  margin: 12px 0 20px;
  display: flex;
  justify-content: center;
}

.tutorial-container {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.tutorial-left {
  flex: 1;
  min-width: 200px;
}

.tutorial-right {
  flex: 1;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tutorial-image-wrap {
  width: 100%;
  max-width: 400px;
  height: auto;
  aspect-ratio: 4/3;
  overflow: hidden;
  border-radius: 8px;
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tutorial-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tutorial-note {
  font-size: 12px;
  color: #888;
  line-height: 1.5;
}

.tutorial-controls {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

/* 在较小屏幕上竖排排列 */
@media (max-width: 768px) {
  .tutorial-container {
    flex-direction: column;
  }

  .tutorial-right {
    width: 100%;
    max-width: none;
  }
}

.footer-tip {
  text-align: center;
  padding: 24px;
  color: #f59e0b;
  font-weight: 500;
  font-size: 14px;
}

/* 图片预览对话框样式 */
.preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 250px;
  padding: 16px;
  background: #f9fafb;
}

.preview-image {
  max-width: 450px;
  max-height: 350px;
  width: auto;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  object-fit: contain;
}

.textlayers-panel {
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #eee;
}

.textlayers-list {
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.textlayer-item {
  padding: 8px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
}

.textlayer-text {
  font-size: 13px;
  color: #0f172a;
  margin-bottom: 6px;
}

.textlayer-meta {
  font-size: 12px;
  color: #64748b;
}

/* 上传对话框样式 */
.upload-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.upload-block {
  width: 100%;
}

.local-preview {
  width: 100%;
  max-height: 240px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.local-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.algorithm-selector {
  padding: 12px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.selector-label {
  font-size: 14px;
  color: #475569;
  margin-bottom: 8px;
  font-weight: 500;
}

.upload-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #94a3b8;
  padding: 40px;
}
</style>
