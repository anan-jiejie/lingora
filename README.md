# Lingora 灵语同传 · 官网

> 近乎零延迟的 AI 实时同声传译与会议助理 —— 品牌官网（静态站）

一个零依赖的静态站点：**纯 HTML + CSS + 原生 JS**，不需要构建步骤，克隆即用、推送即上线。

---

## 线上地址

**https://anan-jiejie.github.io/lingora/**

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/anan-jiejie/lingora |
| 托管方式 | GitHub Pages · `Deploy from a branch` |
| 分支 / 目录 | `main` + `/ (root)` |
| HTTPS | 已强制 |
| 发布提交 | `081aadc`（新增 `.nojekyll` 以关闭 Jekyll 处理） |

## 目录结构

```
lingora-site/
├── index.html          # 单页站点，全部内容（语义化标签 + SEO meta）
├── assets/
│   ├── styles.css      # 设计令牌 + 全部样式 + 响应式断点
│   └── main.js         # 全部交互（无任何第三方依赖）
├── .nojekyll           # 空文件，告诉 GitHub Pages 跳过 Jekyll 处理
├── .gitignore          # 排除 .verify/ 等本地校验产物
└── README.md
```

## 本地预览

任选一种，在 `lingora-site/` 目录下执行：

```bash
# Python（推荐，零安装）
python -m http.server 8099

# Node
npx serve -l 8099

# 或者直接用浏览器打开 index.html 也可以跑
```

打开 http://127.0.0.1:8099/

> 一定要用 HTTP 服务预览，不要直接双击 `index.html`：`file://` 协议下部分浏览器会拦截字体与脚本。

## 部署到 GitHub Pages

### 方式 A：仓库根目录托管（最简单）

```bash
cd lingora-site
git init
git add .
git commit -m "feat: Lingora 官网首版"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 仓库页：**Settings → Pages → Build and deployment**
- Source 选 `Deploy from a branch`
- Branch 选 `main`，目录选 `/ (root)`
- 保存后约 1 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

### 方式 B：推到已有仓库的子目录

```bash
# 假设已有一个 pages 仓库，本地路径为 D:\my-pages
cd D:/my-pages
mkdir -p lingora
cp -r /path/to/lingora-site/* lingora/
git add lingora
git commit -m "feat: 新增 Lingora 官网"
git push
```

访问 `https://<你的用户名>.github.io/<仓库名>/lingora/`

### 方式 C：部署到 `用户名.github.io` 个人主页仓库

直接把 `lingora-site/` 里的文件拷到该仓库根目录推送，访问 `https://<你的用户名>.github.io/`

> ⚠️ 两个常见坑：
> 1. 仓库里**不要出现大写开头的 `Index.html`**，GitHub Pages 只认小写 `index.html`。
> 2. 推完看不到更新时，先看 **Actions** 标签页里 `pages build and deployment` 是否跑成功，再强刷浏览器（Ctrl+F5）绕过 CDN 缓存。

## 换品牌 / 换配色

所有颜色、字号、圆角都收敛在 `assets/styles.css` 顶部的 `:root` 里：

```css
--lang-a: #12E1B0;   /* 语言 A / 原文 —— 电光青 */
--lang-b: #FF7A5C;   /* 语言 B / 译文 —— 暖珊瑚 */
--ink-1:  #080D18;   /* 深色底 */
--paper:  #F6F4EF;   /* 浅色底 */
```

改这几个值就能整体换皮。品牌名替换搜 `Lingora` 与 `灵语同传` 即可。

## 已实现的交互

| 交互 | 说明 |
|---|---|
| 导航栏滚动毛玻璃 | 滚动超过 12px 自动加背景模糊、描边与投影 |
| 移动端汉堡菜单 | ≤1024px 出现，支持 Esc 关闭、点链接自动收起 |
| 当前区块高亮 | 滚动时导航自动高亮所在区块，顶部不高亮 |
| Hero 字幕演示窗 | 逐字打字机效果、循环播放、语言对切换、实时计时 |
| 音频波形 | 18 根柱子错频跳动，其中数根用珊瑚色呼应「译文」 |
| 滚动揭示 | IntersectionObserver + 逐项延迟，形成瀑布式入场 |
| 数字滚动 | 10,000+ / 60+ / &lt;1s / 4.1 进入视口时缓动计数 |
| 价格货币切换 | 人民币 ⇄ 美元一键换算，数字带翻动反馈 |
| FAQ 手风琴 | 高度动画 + 加号旋转成减号，单开互斥 |
| 返回顶部 | 滚动 900px 后浮现 |
| 无障碍 | skip-link、aria-expanded、aria-live、focus-visible 描边 |
| 减少动效 | 全站尊重 `prefers-reduced-motion` |
| 响应式 | 1440 / 1200 / 1024 / 760 四个断点，无横向溢出 |

## 无障碍与 SEO 检查项

- `<html lang="zh-CN">`、语义化 `header / main / section / article / nav / footer`
- 所有 SVG 装饰图形 `aria-hidden="true"`，图标不带文字含义
- `<noscript>` 兜底：禁用 JS 时所有内容依然可见
- 图片无外链依赖，字体走 Google Fonts 并配置系统字体回退
