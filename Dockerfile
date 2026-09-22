# Lingora 账户后端 · 容器镜像
# 构建上下文 = 站点根目录（lingora-site/），因为服务要同时托管前端静态文件
FROM node:20-alpine

WORKDIR /app

# 零 npm 依赖：没有 npm install，镜像构建秒级完成
COPY . /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# 非 root 运行
USER node

CMD ["node", "server/app.js"]
