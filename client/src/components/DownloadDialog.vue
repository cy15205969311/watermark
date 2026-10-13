<template>
  <el-dialog v-model="visible" title="下载选项" :width="'720px'" @close="onClose">
    <div class="download-grid">
      <div class="left">
        <p v-if="record?.isAnimated === true" role="status">下载已验证的动态 {{ record.detectedFormat?.toUpperCase() || 'GIF' }} 文件，保留动画帧。</p>
        <p v-if="resourceStatusText(record || {})" role="status">{{ resourceStatusText(record || {}) }}</p>
        <p v-if="record?.downloadStatus === 'preview_only' && officialShareUrl(record)"><a :href="officialShareUrl(record)" target="_blank" rel="noopener noreferrer">前往官方分享页，按平台权限登录并下载</a></p>
        <h4 v-else>选择格式</h4>
        <el-radio-group v-if="record?.isAnimated !== true" v-model="format" size="small">
          <el-radio-button label="png">高精PNG</el-radio-button>
          <el-radio-button label="jpg">JPG</el-radio-button>
          <el-radio-button label="gif">GIF动图</el-radio-button>
          <el-radio-button label="pdf">PDF</el-radio-button>
        </el-radio-group>

        <h4 style="margin-top:16px">是否打码</h4>
        <el-radio-group v-model="printOption" size="small">
          <el-radio-button label="no">不打码</el-radio-button>
          <el-radio-button label="yes">打码</el-radio-button>
        </el-radio-group>

        <div style="margin-top:18px">
          <el-button type="primary" @click="confirmDownload">确认下载</el-button>
          <el-button @click="onClose">取消</el-button>
        </div>
      </div>

      <div class="right">
        <h4>预览</h4>
        <div class="preview">
          <img :src="record?.animationUrl || record?.imageUrl || record?.thumbnailUrl" alt="preview" />
        </div>
        <div class="note">文件名：{{ filename }}</div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, watch, ref } from 'vue'
import { resourceStatusText, officialShareUrl } from '../utils/resourceStatus'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  record: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'download'])

const visible = ref(props.modelValue)
const format = ref('png')
const printOption = ref('no')

watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => emit('update:modelValue', v))

const filename = computed(() => {
  const id = props.record?.id || Date.now()
  return `download-${id}.${props.record?.isAnimated ? props.record.detectedFormat || 'gif' : format.value}`
})

function onClose() {
  visible.value = false
}

function confirmDownload() {
  // Emit download event to parent with options
  emit('download', { record: props.record, format: format.value, print: printOption.value })
  visible.value = false
}
</script>

<style scoped>
.download-grid {
  display: flex;
  gap: 20px;
}

.left {
  flex: 1
}

.right {
  flex: 1
}

.preview {
  background: #f7f7f7;
  border-radius: 6px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden
}

.preview img {
  max-width: 100%;
  max-height: 100%;
  display: block
}

.note {
  margin-top: 8px;
  color: #64748b
}
</style>
