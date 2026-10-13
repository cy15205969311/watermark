export function resourceStatusText(record = {}) {
  if (record.originalResourceStatus === 'original_verified') return '已验证原始动画资源，是否带水印尚未确认'
  if (record.originalResourceStatus === 'authorized_export_verified') return '已验证平台授权导出，是否带水印尚未确认'
  if (record.animationStatus === 'preview_only') return '仅取得静态预览，未取得已验证动画'
  if (record.downloadStatus === 'preview_only' || record.animationStatus === 'verified_animated') {
    if ((record.pages || []).some(page => ['original_verified', 'authorized_export_verified'].includes(page.downloadStatus))) {
      return '部分页面仅有预览，原始文件未全部取得；下载保留各页现有资源'
    }
    return record.originalResourceStatus === 'unknown'
      ? '动态资源属性尚未确认，未确认原始文件'
      : '仅取得动态预览，尚未取得原始文件；下载保留预览内容'
  }
  return ''
}

export function officialShareUrl(record = {}) {
  try {
    const url = new URL(record.originalUrl || record.original_url)
    return url.protocol === 'https:' && /(^|\.)(818ps|tuguaishou)\.com$/.test(url.hostname) ? url.href : null
  } catch { return null }
}
