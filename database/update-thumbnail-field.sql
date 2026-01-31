-- 扩展thumbnail_url字段以支持Puppeteer截图的base64数据
USE watermark_remover;

ALTER TABLE parse_records 
MODIFY COLUMN thumbnail_url LONGTEXT 
COMMENT 'Support base64 images up to 16MB for Puppeteer screenshots';

-- 验证字段修改
DESCRIBE parse_records;
