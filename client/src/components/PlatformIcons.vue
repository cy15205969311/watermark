<template>
  <div class="platform-section">
    <div class="section-header">
      <span class="section-title">支持平台</span>
      <div class="divider"></div>
    </div>

    <div class="platform-list">
      <el-tag v-for="platform in platforms" :key="platform.name" :color="platform.color"
        :style="{ color: platform.textColor }" size="small" class="platform-tag">
        {{ platform.name }}
      </el-tag>

      <el-tag size="small" type="info" class="platform-tag">
        ...等平台
      </el-tag>
    </div>
  </div>
</template>

<script setup>
const platforms = [
  { name: '图怪兽', color: '#16a34a', textColor: '#ffffff' },
  { name: '创客贴', color: '#10b981', textColor: '#ffffff' },
  { name: '稿定设计', color: '#f97316', textColor: '#ffffff' }
]
</script>

<style scoped>
.platform-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.divider {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.2);
}

.platform-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.platform-tag {
  border: none;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  cursor: default;
}

.platform-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}
</style>
