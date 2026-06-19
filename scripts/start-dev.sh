#!/bin/bash

echo "🚀 启动古事开发环境..."
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，正在从 .env.example 复制..."
    cp .env.example .env
    echo "✅ .env 文件已创建，请检查配置后重新运行"
    exit 1
fi

# 启动数据库
echo "📦 启动 PostgreSQL 数据库..."
docker-compose up -d postgres

# 等待数据库就绪
echo "⏳ 等待数据库就绪..."
sleep 5

# 检查数据库连接
echo "🔍 检查数据库连接..."
if ! npx prisma db pull --force > /dev/null 2>&1; then
    echo "❌ 数据库连接失败，请检查配置"
    exit 1
fi
echo "✅ 数据库连接成功"

# 应用迁移
echo "📋 检查数据库迁移..."
npx prisma migrate deploy

# 生成 Prisma 客户端
echo "⚙️  生成 Prisma 客户端..."
npx prisma generate

echo ""
echo "✅ 所有准备工作已完成！"
echo ""
echo "🌟 启动开发服务器..."
echo "访问地址: http://localhost:3000"
echo ""

npm run dev
