<template>
  <el-button v-if="desktop" text @click="open">设置与数据管理</el-button>
  <el-dialog v-model="visible" title="设置与数据管理" class="desktop-settings-dialog" append-to-body top="5vh" width="min(760px, 94vw)" :close-on-click-modal="!working" :close-on-press-escape="!working" :show-close="!working">
    <div v-loading="loading" class="desktop-settings" :aria-busy="working || loading">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <p v-if="message" role="status" class="settings-message">{{ message }}</p>
      <template v-if="info">
        <section aria-labelledby="settings-general">
          <h2 id="settings-general">运行状态</h2>
          <dl class="settings-facts">
            <dt>应用版本</dt><dd>{{ info.version }} · {{ info.mode }}</dd>
            <dt v-if="info.installDirectory">安装目录</dt><dd v-if="info.installDirectory">{{ info.installDirectory }}</dd>
            <dt>存储范围</dt><dd>{{ info.storageScope === 'machine' ? '所有用户安装 · 当前 Windows SID 独立数据' : '当前用户独立数据' }}</dd>
            <dt>个人数据</dt><dd>{{ info.dataDirectory }}</dd>
            <dt>数据库文件</dt><dd>{{ info.databasePath }}</dd>
            <dt>浏览器配置</dt><dd>{{ info.browserProfileDirectory }}</dd>
            <dt>运行缓存</dt><dd>{{ info.cacheDirectory }}</dd>
            <dt>备份目录</dt><dd>{{ info.backupDirectory }}</dd>
            <dt>日志目录</dt><dd>{{ info.logsDirectory }}</dd>
            <dt>历史数据库</dt><dd>{{ info.database?.ready ? '已就绪' : '未就绪' }} · 结构版本 {{ info.database?.schemaVersion ?? '未知' }}</dd>
            <dt>随包浏览器</dt><dd>{{ info.chromiumVersion }} · {{ info.browser?.available }} 个空闲 / {{ info.browser?.inUse }} 个使用中</dd>
            <dt>浏览器位置</dt><dd>{{ info.chromiumPath }}</dd>
            <dt>最近启动失败</dt><dd>{{ info.recentBrowserFailure || '本次运行未记录启动失败' }}</dd>
          </dl>
        </section>
        <section aria-labelledby="settings-download">
          <h2 id="settings-download">下载保存位置</h2>
          <p class="settings-path">{{ info.downloadDirectory }}</p>
          <el-alert v-if="info.downloadWarning" :title="info.downloadWarning" type="warning" :closable="false" show-icon />
          <p class="settings-note">保存对话框从此目录打开，仍可为每次下载选择其他位置。GIF 保留原始格式。</p>
          <div class="settings-actions">
            <el-button :disabled="working" @click="act('openDownloadDirectory')">打开下载文件夹</el-button>
            <el-button :disabled="working" @click="act('chooseDownloadDirectory')">选择文件夹</el-button>
            <el-button :disabled="working" @click="act('resetDownloadDirectory')">恢复默认目录</el-button>
          </div>
        </section>
        <section aria-labelledby="settings-backup">
          <h2 id="settings-backup">个人数据备份与恢复</h2>
          <p class="settings-note">备份包含历史数据库、个人配置和上传文件，保存为独立的 .dexp-backup 文件夹。请妥善保管整个文件夹，其中可能包含私人图片与资源链接。</p>
          <p class="settings-note">恢复会替换当前个人数据；确认前会显示备份内容，并自动创建当前状态的回滚备份。请先完成提取和下载。</p>
          <div class="settings-actions">
            <el-button type="primary" :disabled="working" @click="act('backup')">立即备份</el-button>
            <el-button :disabled="working" @click="act('restore')">选择备份并恢复</el-button>
          </div>
        </section>
        <section aria-labelledby="settings-diagnostics">
          <h2 id="settings-diagnostics">问题诊断</h2>
          <p class="settings-note">导出运行状态、任务耗时和近期操作结果。导出前可查看包含范围并取消，文件仅保存在本机。</p>
          <div class="settings-actions">
            <el-button :disabled="working" @click="act('exportDiagnostics')">导出诊断信息</el-button>
            <el-button :disabled="working" @click="act('openLogs')">打开日志文件夹</el-button>
          </div>
        </section>
      </template>
    </div>
    <template #footer>
      <span v-if="working" role="status">正在处理，请等待完成…</span>
      <el-button :disabled="working" @click="refresh">刷新状态</el-button>
      <el-button :disabled="working" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const desktop = window.desktop
const visible = ref(false), loading = ref(false), working = ref(false)
const info = ref(null), error = ref(''), message = ref('')
let removeListener
async function refresh() {
  loading.value = true
  try {
    const result = await desktop.getSettings()
    if (result.error) throw new Error(result.error)
    info.value = result
  } catch (e) { error.value = e.message || '无法读取运行状态' }
  finally { loading.value = false }
}
async function open() {
  visible.value = true; error.value = ''; message.value = ''; await refresh()
}
async function act(method) {
  if (working.value) return
  working.value = true; error.value = ''; message.value = ''
  try {
    const result = await desktop[method]()
    if (result?.error) throw new Error(result.error)
    message.value = result?.canceled ? '已取消，个人数据和设置未改变。' : method === 'backup' ? `备份已保存：${result.directory}` : method === 'restore' ? '恢复完成，正在重新加载历史记录。' : method === 'exportDiagnostics' ? '诊断信息已保存。' : method === 'openLogs' ? (result || '已打开日志文件夹。') : method === 'openDownloadDirectory' ? '已打开下载文件夹。' : '下载目录已保存。'
    await refresh()
  } catch (e) { error.value = e.message || '操作失败，请重试' }
  finally { working.value = false }
}
const protectWork = event => { if (working.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { removeListener = desktop?.onShowSettings?.(open); window.addEventListener('beforeunload', protectWork) })
onUnmounted(() => { removeListener?.(); window.removeEventListener('beforeunload', protectWork) })
</script>

<style scoped>
.desktop-settings { --settings-space: 1rem; color: var(--el-text-color-primary); }
:global(.desktop-settings-dialog .el-dialog__body) { max-height: 68vh; overflow-y: auto; }
.desktop-settings section + section { margin-top: calc(var(--settings-space) * 2); padding-top: var(--settings-space); border-top: 1px solid var(--el-border-color-light); }
.desktop-settings h2 { margin: 0 0 var(--settings-space); font-size: 16px; font-weight: 600; }
.settings-facts { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .75rem var(--settings-space); margin: 0; font-size: 14px; }
.settings-facts dt, .settings-note { color: var(--el-text-color-regular); }
.settings-facts dd { margin: 0; overflow-wrap: anywhere; }
.settings-path { overflow-wrap: anywhere; font-size: 14px; }
.settings-note { font-size: 14px; line-height: 1.7; margin: .5rem 0 1rem; }
.settings-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.settings-actions .el-button + .el-button { margin-left: 0; }
.settings-message { color: var(--el-color-success-dark-2); overflow-wrap: anywhere; }
</style>
