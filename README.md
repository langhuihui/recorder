# 🎵 亚萨诗班官方网站

基于 Astro + Cloudflare Pages + R2 + D1 构建的亚萨诗班（Asaph Choir）官方网站。

## 功能特性

### 公开网站
- 🏠 **首页** — 诗班简介、圣经经文、专辑预览、诗班文化展示
- 🎵 **专辑页** — 专辑列表与详情，内置音频播放器，支持切换声部（高/中/次中/低音）
- 📱 **移动端适配** — 所有页面均适配手机/平板访问

### 后台管理
- 📊 **仪表盘** — 歌曲/专辑统计快览
- 🎵 **歌曲管理** — 上传歌曲（含歌谱图片/PDF、伴奏/范唱音频），支持最多 4 个声部
- 💿 **专辑管理** — 创建/编辑专辑，添加封面，管理歌曲列表
- 📁 **练唱文件** — 上传/分类管理练唱相关文件供诗班成员使用

### API 接口
所有接口均提供 CORS 支持，可供第三方程序调用：
- `GET /api/albums` — 专辑列表
- `GET /api/albums/:id` — 专辑详情（含歌曲列表和音频 URL）
- `GET /api/songs` — 歌曲列表
- `GET /api/songs/:id` — 歌曲详情
- `GET /api/files/{file_key}` — 文件访问（支持 Range 请求）
- `GET /api/practice-files` — 练唱文件列表

## 技术栈

- **前端框架**: Astro（静态构建）
- **运行时**: Cloudflare Pages Functions (Workers)
- **存储**: Cloudflare R2（文件）+ D1（元数据）
- **样式**: 纯 CSS，无 UI 库依赖

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 创建 Cloudflare 资源

```bash
# 创建 R2 存储桶
wrangler r2 bucket create song-files

# 创建 D1 数据库
wrangler d1 create song-db
```

将返回的 `database_id` 更新到 `wrangler.jsonc` 中的 `YOUR_D1_DATABASE_ID`。

### 3. 执行数据库迁移

```bash
# 本地开发
pnpm db:migrate

# 远程生产
pnpm db:migrate:remote
```

### 4. 本地开发

```bash
pnpm dev
```

### 5. 构建 & 部署

```bash
pnpm build
pnpm deploy
```

## 项目结构

```
├── src/
│   ├── pages/
│   │   ├── index.astro          # 首页
│   │   ├── albums/
│   │   │   └── index.astro      # 专辑列表 + 详情 (SPA)
│   │   └── admin/
│   │       ├── index.astro      # 仪表盘
│   │       ├── songs.astro      # 歌曲管理
│   │       ├── albums.astro     # 专辑管理
│   │       └── practice.astro   # 练唱文件
│   ├── layouts/
│   │   ├── Layout.astro         # 公开页面布局
│   │   └── AdminLayout.astro    # 后台布局
│   └── styles/
│       └── global.css           # 全站样式
├── functions/
│   └── api/                     # Cloudflare Pages Functions API
│       ├── songs.js
│       ├── albums.js
│       ├── practice-files.js
│       └── files/[[path]].js
├── public/
│   ├── img/                     # 静态图片
│   ├── favicon.svg
│   └── _redirects               # Cloudflare Pages 路由
├── migrations/                  # D1 数据库迁移
└── wrangler.jsonc
```
