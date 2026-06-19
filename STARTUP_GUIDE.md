# 古事项目启动指南

## 一、前置条件

确保已安装：
- Docker 和 Docker Compose
- Node.js 18+
- npm 或 yarn

## 二、环境配置

1. 复制环境变量文件（如果还没有）：
```bash
cp .env.example .env
```

2. 检查 `.env` 文件中的关键配置：
```bash
# 数据库连接
DATABASE_URL="postgresql://gushi:gushi_dev@localhost:5433/gushi_dev"

# 认证密钥（生产环境务必更换）
AUTH_SECRET=your_auth_secret_here_please_change_in_production
NEXTAUTH_SECRET=your_nextauth_secret_here_please_change_in_production

# AI API 配置
AI_API_KEY=你的AI_API密钥
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
```

## 三、启动方式

### 方式一：本地开发（推荐用于开发调试）

#### 1. 启动数据库
```bash
# 仅启动 PostgreSQL 数据库
docker-compose up -d postgres

# 检查数据库状态
docker-compose ps
```

#### 2. 安装依赖
```bash
npm install
```

#### 3. 初始化数据库（首次运行或 schema 变更后）
```bash
# 生成 Prisma 客户端
npx prisma generate

# 应用数据库迁移
npx prisma migrate deploy

# （可选）填充种子数据
npm run db:seed
```

#### 4. 启动开发服务器
```bash
npm run dev
```

访问：http://localhost:3000

#### 5. 数据库管理工具（可选）
```bash
# 启动 Prisma Studio（可视化管理界面）
npx prisma studio
```
访问：http://localhost:5555

---

### 方式二：Docker Compose 生产部署

#### 1. 启动所有服务
```bash
# 启动数据库 + 应用
docker-compose up -d

# 查看服务状态
docker-compose ps
```

#### 2. 查看日志
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f gushi-app
```

#### 3. 停止服务
```bash
docker-compose down
```

访问：http://localhost:3000

---

### 方式三：开发环境 Docker（热重载）

#### 1. 启动开发容器
```bash
# 启动数据库 + 开发服务器（带热重载）
docker-compose --profile dev up -d

# 查看日志
docker-compose logs -f gushi-dev
```

访问：http://localhost:3001

---

## 四、常用操作命令

### 数据库操作
```bash
# 查看数据库迁移状态
npx prisma migrate status

# 创建新的迁移
npx prisma migrate dev --name 描述名称

# 重置数据库（危险操作！会清空数据）
npx prisma migrate reset

# 推送 schema 变更（不创建迁移文件）
npx prisma db push
```

### Docker 操作
```bash
# 重启服务
docker-compose restart

# 停止并删除所有容器
docker-compose down

# 停止并删除容器 + 数据卷（危险操作！会清空数据库）
docker-compose down -v

# 查看容器日志
docker logs gushi-postgres
docker logs gushi-app

# 进入容器内部
docker exec -it gushi-postgres bash
```

### 测试
```bash
# 运行所有测试
npx vitest

# 运行特定测试文件
npx vitest path/to/test.file.ts

# 监听模式
npx vitest watch
```

---

## 五、故障排查

### 问题 1：数据库连接失败
```bash
# 检查数据库容器状态
docker ps | grep gushi-postgres

# 如果没有运行，启动它
docker-compose up -d postgres

# 等待几秒后测试连接
npx prisma db pull --force
```

### 问题 2：端口被占用
```bash
# 检查端口占用
lsof -i :3000  # 应用端口
lsof -i :5433  # 数据库端口

# 修改 docker-compose.yml 中的端口映射
```

### 问题 3：Prisma 客户端错误
```bash
# 重新生成客户端
npx prisma generate

# 清理 node_modules 并重新安装
rm -rf node_modules
npm install
```

### 问题 4：Docker 构建失败
```bash
# 清理 Docker 缓存
docker system prune -a

# 重新构建
docker-compose build --no-cache
```

---

## 六、推荐的开发工作流

### 每日启动流程
```bash
# 1. 启动数据库
docker-compose up -d postgres

# 2. 启动开发服务器
npm run dev

# 3. （可选）启动 Prisma Studio
npx prisma studio
```

### 关闭流程
```bash
# 停止开发服务器：Ctrl+C

# 停止数据库（可选，建议保持运行）
docker-compose stop postgres
```

---

## 七、生产环境部署清单

- [ ] 修改 `.env` 中的所有密钥和密码
- [ ] 配置 SSL 证书（nginx 配置）
- [ ] 设置数据库备份策略
- [ ] 配置日志收集
- [ ] 设置监控告警
- [ ] 配置 CDN（可选）

---

## 八、快速启动脚本

### 创建快速启动脚本（可选）

#### `scripts/start-dev.sh`
```bash
#!/bin/bash
echo "🚀 启动古事开发环境..."

# 启动数据库
echo "📦 启动数据库..."
docker-compose up -d postgres

# 等待数据库就绪
echo "⏳ 等待数据库就绪..."
sleep 3

# 检查迁移状态
echo "🔍 检查数据库迁移..."
npx prisma migrate deploy

# 启动开发服务器
echo "🌟 启动开发服务器..."
npm run dev
```

#### 使用方法
```bash
chmod +x scripts/start-dev.sh
./scripts/start-dev.sh
```

---

## 九、服务地址汇总

| 服务 | 地址 | 说明 |
|------|------|------|
| 应用首页 | http://localhost:3000 | 主应用 |
| 开发环境 | http://localhost:3001 | Docker 开发容器 |
| Prisma Studio | http://localhost:5555 | 数据库可视化管理 |
| PostgreSQL | localhost:5433 | 数据库连接 |
| Redis | localhost:6379 | 缓存服务（可选）|

---

## 十、获取帮助

- 查看 CLAUDE.md 了解项目详情
- 查看日志排查问题：`docker-compose logs -f`
- Prisma 文档：https://www.prisma.io/docs
- Next.js 文档：https://nextjs.org/docs
