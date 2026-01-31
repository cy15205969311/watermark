#!/bin/bash

# 去水印助手部署脚本
# 使用方法: chmod +x deploy.sh && ./deploy.sh

set -e

echo "🚀 开始部署去水印助手..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置变量 - 请修改这些值
PROJECT_DIR="/var/www/watermark-remover"
DOMAIN="your-domain.com"  # 改为你的域名，如：qushuiyin.com
DB_PASSWORD="MyStr0ngP@ssw0rd2024"  # 改为你的强密码

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用root用户运行此脚本${NC}"
    exit 1
fi

# 1. 更新系统
echo -e "${YELLOW}[1/10] 更新系统...${NC}"
apt update && apt upgrade -y

# 2. 安装Node.js
echo -e "${YELLOW}[2/10] 安装Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt-get install -y nodejs
fi

# 3. 安装其他软件
echo -e "${YELLOW}[3/10] 安装MySQL, Nginx, Git...${NC}"
apt-get install -y mysql-server nginx git

# 4. 安装PM2
echo -e "${YELLOW}[4/10] 安装PM2...${NC}"
npm install -g pm2

# 5. 配置MySQL
echo -e "${YELLOW}[5/10] 配置MySQL...${NC}"
systemctl start mysql
systemctl enable mysql

# 创建数据库和用户
mysql -e "CREATE DATABASE IF NOT EXISTS watermark_remover CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS 'watermark_user'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
mysql -e "GRANT ALL PRIVILEGES ON watermark_remover.* TO 'watermark_user'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# 6. 创建项目目录
echo -e "${YELLOW}[6/10] 创建项目目录...${NC}"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# 如果当前目录有文件，复制到项目目录
if [ -f "$(dirname "$0")/package.json" ]; then
    cp -r $(dirname "$0")/* $PROJECT_DIR/
fi

# 7. 安装依赖和构建
echo -e "${YELLOW}[7/10] 安装依赖和构建前端...${NC}"
cd $PROJECT_DIR/server
npm install --production

cd $PROJECT_DIR/client
npm install
npm run build

# 8. 配置环境变量
echo -e "${YELLOW}[8/10] 配置环境变量...${NC}"
cd $PROJECT_DIR/server
cat > .env << EOF
NODE_ENV=production
DB_HOST=localhost
DB_USER=watermark_user
DB_PASSWORD=$DB_PASSWORD
DB_NAME=watermark_remover
PORT=3000
DOMAIN=$DOMAIN
EOF

# 9. 导入数据库
echo -e "${YELLOW}[9/10] 导入数据库...${NC}"
if [ -f "$PROJECT_DIR/database/schema.sql" ]; then
    mysql -u watermark_user -p$DB_PASSWORD watermark_remover < $PROJECT_DIR/database/schema.sql
fi

# 10. 配置Nginx
echo -e "${YELLOW}[10/10] 配置Nginx...${NC}"
cat > /etc/nginx/sites-available/watermark-remover << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location / {
        root $PROJECT_DIR/client/dist;
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/watermark-remover /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# 设置文件权限
chown -R www-data:www-data $PROJECT_DIR
chmod -R 755 $PROJECT_DIR

# 启动应用
cd $PROJECT_DIR/server
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# 配置防火墙
ufw --force enable
ufw allow ssh
ufw allow 80
ufw allow 443

echo -e "${GREEN}✅ 部署完成！${NC}"
echo -e "${GREEN}网站地址: http://$DOMAIN${NC}"
echo -e "${YELLOW}建议接下来配置SSL证书:${NC}"
echo -e "${YELLOW}certbot --nginx -d $DOMAIN -d www.$DOMAIN${NC}"

# 显示状态
echo -e "\n${YELLOW}服务状态:${NC}"
systemctl status nginx --no-pager -l
pm2 status