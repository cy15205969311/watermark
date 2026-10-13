-- 创建数据库
CREATE DATABASE IF NOT EXISTS watermark_remover CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE watermark_remover;

-- 创建解析记录表
CREATE TABLE IF NOT EXISTS parse_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_url VARCHAR(500) NOT NULL,
  platform VARCHAR(50) DEFAULT 'Unknown',
  client_id VARCHAR(128) NULL COMMENT 'Browser/device level isolation key',
  client_ip VARCHAR(64) NULL COMMENT 'Client IP captured from proxy headers',
  thumbnail_url LONGTEXT COMMENT 'Support base64 images up to 16MB for Puppeteer screenshots',
  status VARCHAR(32) NOT NULL DEFAULT 'success' COMMENT 'success / expired / processing / preview_image / preview_only',
  extraction_metadata_json LONGTEXT NULL COMMENT 'Extraction completeness and verified animation metadata',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_created_at (created_at),
  INDEX idx_platform (platform),
  INDEX idx_client_id (client_id),
  INDEX idx_client_ip (client_ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入初始测试数据
INSERT INTO parse_records (original_url, platform, thumbnail_url, status) VALUES
('https://818ps.com/u/002dJRlr-1?user_s...', '818ps', 'https://picsum.photos/400/200?grayscale', 'success'),
('https://v.douyin.com/xf8s9d/', 'Douyin', 'https://picsum.photos/400/200?blur=2', 'expired');
