-- 扩展 parse_records.status 字段，支持预览图类状态
USE watermark_remover;

ALTER TABLE parse_records
MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'success'
COMMENT 'success / expired / processing / preview_image / preview_only';

-- 验证字段修改
DESCRIBE parse_records;
