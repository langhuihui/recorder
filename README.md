# 🎵 Asaph Choir Official Website

基于 Astro + Cloudflare Pages + R2 + D1 构建的 Asaph Choir 官方网站。

## 功能特性

### 公开网站
- 🏠 **首页** — 诗班简介、圣经经文、专辑预览、诗班文化展示
- 🎵 **专辑页** — 专辑列表与详情，内置音频播放器（专辑曲目为单条欣赏音频 + 可选歌谱）
- 📱 **移动端适配** — 所有页面均适配手机/平板访问

### 后台管理
- 📊 **仪表盘** — 歌曲/专辑统计快览
- 🎵 **专辑歌曲** — 归属专辑的欣赏曲目：可选歌谱 + 一条音频
- 🎤 **练唱歌曲** — 练唱曲目：可选歌谱、四部范唱（SATB）、整曲伴奏一条
- 💿 **专辑管理** — 创建/编辑专辑，添加封面，管理专辑内歌曲列表

### API 接口
所有接口均提供 CORS 支持，可供第三方程序调用。

#### 数据划分（调用公开 API 前）

| 类型 | 说明 | 公开获取方式 |
|------|------|----------------|
| **练唱歌曲** | `songs.song_kind = 'practice'`，供分声部练习 | **`/api/public/songs`**、**`/api/public/songs/:id`**、**`/api/public/songs/:id/download`** |
| **专辑歌曲** | `songs.song_kind = 'album'`，供欣赏 | **`/api/albums`**、**`/api/albums/:id`**（含曲目与音轨 URL） |

对 **专辑歌曲** 的 ID 调用 `/api/public/songs/:id` 会返回 **404**，正文提示应从专辑入口收听。

#### 公开 API（无需认证）

- `GET /api/public/songs` — **仅练唱歌曲**列表（`song_kind = practice`），含资源概要
- `GET /api/public/songs/:id` — **仅练唱歌曲**详情（歌谱与各音轨直链）
- `GET /api/public/songs/:id/download` — **仅练唱歌曲**资源列表或单文件下载（`direct=true`）
- `GET /api/albums` — 专辑列表
- `GET /api/albums/:id` — 专辑详情（含专辑内歌曲与音频 URL）

#### 管理 API（写操作需登录认证）

- `GET /api/songs` — 歌曲列表（可用 `?song_kind=album` / `practice` 筛选）
- `GET /api/songs/:id` — 歌曲详情（两种 kind 均可）
- `GET /api/files/{file_key}` — 文件访问（支持 Range 请求）
- `GET /api/practice-files` — 练习文件元数据列表（管理端；**公开客户端获取练唱资源请用 `/api/public/songs*`**）

---

### 公开 API 详细文档（练唱歌曲）

以下接口**只**面向练唱歌曲。每首练唱歌可包含：歌谱（多张）、**范唱**（`vocal`，按声部）、**伴奏**（`accompaniment`，通常为整曲一条时 `part_name` 为 `default`）。

四部范唱声部名称为固定枚举：`soprano`、`alto`、`tenor`、`bass`（后台展示为女高音 / 女低音 / 男高音 / 男低音）。`part_label` 来自数据库，若为空则回退为 `part_name`。

#### 1. 获取歌曲列表

```
GET /api/public/songs?page=1&limit=20
```

返回 **练唱歌曲**列表，每首歌包含资源概要（歌谱数量、已上传的范唱/伴奏声部）：

```json
{
  "data": [
    {
      "id": "8da56907-...",
      "title": "茉莉花",
      "artist": "中国民歌",
      "description": "经典合唱曲目",
      "cover_url": "https://xxx/api/files/songs/.../sheets/xxx.png",
      "resources": {
        "sheets": 3,
        "vocal_parts": [
          { "part_name": "soprano", "part_label": "女高音（Soprano）" },
          { "part_name": "alto", "part_label": "女低音（Alto）" },
          { "part_name": "tenor", "part_label": "男高音（Tenor）" },
          { "part_name": "bass", "part_label": "男低音（Bass）" }
        ],
        "accompaniment_parts": [
          { "part_name": "default", "part_label": "default" }
        ]
      },
      "created_at": "2026-04-10 11:23:57",
      "updated_at": "2026-04-10 11:23:57"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

#### 2. 获取练唱歌曲详情

```
GET /api/public/songs/:id
```

- `id` 必须为 **练唱歌曲**；否则 **404**，`error` 提示从专辑页收听。

返回完整资源列表，每个资源都带可直接访问的 URL：

```json
{
  "data": {
    "id": "8da56907-...",
    "title": "茉莉花",
    "artist": "中国民歌",
    "description": "经典合唱曲目",
    "created_at": "2026-04-10 11:23:57",
    "updated_at": "2026-04-10 11:23:57",
    "resources": {
      "sheets": [
        { "id": "...", "type": "sheet", "url": "https://xxx/api/files/...", "sort_order": 0, "width": 1200, "height": 1600 }
      ],
      "vocal": [
        { "id": "...", "type": "vocal", "part_name": "soprano", "part_label": "女高音（Soprano）", "url": "https://xxx/api/files/...", "file_size": 1024, "duration": 180 },
        { "id": "...", "type": "vocal", "part_name": "alto", "part_label": "女低音（Alto）", "url": "https://xxx/api/files/...", "file_size": 980, "duration": 180 }
      ],
      "accompaniment": [
        { "id": "...", "type": "accompaniment", "part_name": "default", "part_label": "default", "url": "https://xxx/api/files/...", "file_size": 900, "duration": 180 }
      ]
    }
  }
}
```

#### 3. 下载练唱歌曲资源

```
GET /api/public/songs/:id/download
```

同样 **仅** 接受练唱歌曲 `id`。支持筛选参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `type` | 资源类型：`sheet` / `vocal` / `accompaniment` | `type=vocal` |
| `part_name` | 声部：`soprano` / `alto` / `tenor` / `bass`（范唱）；整曲伴奏多为 `default` | `part_name=soprano` |
| `direct` | 设为 `true` 时，筛选到唯一结果则直接返回文件流 | `direct=true` |

**获取资源列表（默认）**：

```
GET /api/public/songs/:id/download?type=vocal
```

```json
{
  "data": {
    "id": "8da56907-...",
    "title": "茉莉花",
    "artist": "中国民歌",
    "resources": [
      { "type": "vocal", "part_name": "soprano", "part_label": "女高音（Soprano）", "url": "https://xxx/api/files/...", "file_size": 1024 }
    ],
    "total": 1
  }
}
```

**直接下载单个文件**：

```
GET /api/public/songs/:id/download?type=vocal&part_name=soprano&direct=true
```

返回文件流，HTTP 头包含：
- `Content-Disposition: attachment; filename*=UTF-8''茉莉花_范唱_女高音（Soprano）.mp3`（文件名中的标签来自 `part_label`）
- `Content-Type: audio/mpeg`

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

按顺序执行 `migrations/` 下全部 SQL（含 `0006_song_kind_practice_file_song.sql`，用于区分专辑歌曲与练唱歌曲）。`pnpm db:migrate` / `pnpm db:migrate:remote` 已串联这些文件。

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
│   │       ├── songs.astro      # 专辑歌曲
│   │       ├── albums.astro     # 专辑管理
│   │       └── practice.astro   # 练唱歌曲
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
