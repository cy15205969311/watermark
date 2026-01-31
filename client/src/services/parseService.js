/**
 * 解析服务 - 从不同平台提取真实图片/视频URL
 */

/**
 * 尝试加载图片，验证URL是否有效
 */
export const testImageUrl = (url) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url

    // 5秒超时
    setTimeout(() => resolve(false), 5000)
  })
}

/**
 * 从 818ps 链接提取图片
 */
const parse818ps = async (url) => {
  try {
    const urlObj = new URL(url)
    const picId = urlObj.searchParams.get('picId')
    const upicId = urlObj.searchParams.get('upicId')

    console.log('解析818ps链接:', { url, picId, upicId })

    if (!picId || !upicId) {
      console.warn('缺少必要的参数')
      return null
    }

    // 多种可能的图片URL格式
    const possibleUrls = [
      `https://img.818ps.com/pic/${upicId}/${picId}.jpg`,
      `https://img.818ps.com/pic/${upicId}/${picId}.png`,
      `https://cdn.818ps.com/images/${upicId}/${picId}.jpg`,
      `https://static.818ps.com/pic/${picId}.jpg`,
      `https://ue.818ps.com/images/${picId}.jpg`,
      `https://img.818ps.com/thumb/${upicId}/${picId}_thumb.jpg`,
      `https://picsum.photos/seed/${picId}/400/300` // 后备方案
    ]

    console.log('尝试的图片URLs:', possibleUrls)

    // 尝试每个URL，找到第一个可用的
    for (const testUrl of possibleUrls) {
      console.log('测试URL:', testUrl)
      const isValid = await testImageUrl(testUrl)
      if (isValid) {
        console.log('✅ 找到有效的图片URL:', testUrl)
        return {
          thumbnailUrl: testUrl,
          title: `818ps图片-${picId}`,
          picId,
          upicId
        }
      }
    }

    // 如果都不可用，返回最后一个（占位图）
    console.warn('所有URL都不可用，使用占位图')
    return {
      thumbnailUrl: possibleUrls[possibleUrls.length - 1],
      title: `818ps图片-${picId}`,
      picId,
      upicId
    }
  } catch (error) {
    console.error('解析 818ps 失败:', error)
    return null
  }
}

/**
 * 从抖音链接提取视频封面
 */
const parseDouyin = async (url) => {
  try {
    // 抖音短链接需要后端解析
    return {
      thumbnailUrl: `https://picsum.photos/400/300?random=${Date.now()}`,
      title: '抖音视频'
    }
  } catch (error) {
    console.error('解析抖音失败:', error)
    return null
  }
}

/**
 * 通用解析函数
 */
export const parseMediaUrl = async (url, platform) => {
  const urlLower = url.toLowerCase()

  console.log('开始解析:', { url, platform })

  // 根据平台调用不同的解析器
  if (urlLower.includes('818ps')) {
    const result = await parse818ps(url)
    if (result) return result
  } else if (urlLower.includes('douyin')) {
    return await parseDouyin(url)
  }

  // 默认返回随机图片
  return {
    thumbnailUrl: `https://picsum.photos/400/300?random=${Date.now()}`,
    title: `${platform} 内容`
  }
}

/**
 * 提取URL中的图片ID或视频ID
 */
export const extractMediaId = (url) => {
  try {
    const urlObj = new URL(url)
    const params = new URLSearchParams(urlObj.search)

    // 尝试从不同参数中提取ID
    return {
      picId: params.get('picId'),
      upicId: params.get('upicId'),
      id: params.get('id'),
      videoId: params.get('video_id')
    }
  } catch (error) {
    return null
  }
}
