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
所有接口均提供 CORS 支持，可供第三方程序调用。

#### 公开 API（无需认证）

- `GET /api/public/songs` — 歌曲列表（含资源概要）
- `GET /api/public/songs/:id` — 歌曲详情（含全部资源 URL）
- `GET /api/public/songs/:id/download` — 下载歌曲资源

#### 管理 API（写操作需登录认证）

- `GET /api/albums` — 专辑列表
- `GET /api/albums/:id` — 专辑详情（含歌曲列表和音频 URL）
- `GET /api/songs` — 歌曲列表
- `GET /api/songs/:id` — 歌曲详情
- `GET /api/files/{file_key}` — 文件访问（支持 Range 请求）
- `GET /api/practice-files` — 练唱文件列表

---

### 公开 API 详细文档

练唱文件以歌曲为一组，每首歌包含：歌谱、范唱（分声部）、伴奏（分声部）。声部通常为四个：女高（soprano）、女低（alto）、男高（tenor）、男低（bass）。

#### 1. 获取歌曲列表

```
GET /api/public/songs?page=1&limit=20
```

返回歌曲列表，每首歌包含资源概要（歌谱数量、范唱/伴奏各声部）：

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
          { "part_name": "soprano", "part_label": "女高" },
          { "part_name": "alto", "part_label": "女低" },
          { "part_name": "tenor", "part_label": "男高" },
          { "part_name": "bass", "part_label": "男低" }
        ],
        "accompaniment_parts": [
          { "part_name": "soprano", "part_label": "女高" }
        ]
      },
      "created_at": "2026-04-10 11:23:57",
      "updated_at": "2026-04-10 11:23:57"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

#### 2. 获取歌曲详情

```
GET /api/public/songs/:id
```

返回完整资源列表，每个资源都带可直接访问的 URL：

```json
{
  "data": {
    "id": "8da56907-...",
    "title": "茉莉花",
    "artist": "中国民歌",
    "description": "经典合唱曲目",
    "resources": {
      "sheets": [
        { "id": "...", "type": "sheet", "url": "https://xxx/api/files/...", "sort_order": 0, "width": 1200, "height": 1600 }
      ],
      "vocal": [
        { "id": "...", "type": "vocal", "part_name": "soprano", "part_label": "女高", "url": "https://xxx/api/files/...", "file_size": 1024, "duration": 180 },
        { "id": "...", "type": "vocal", "part_name": "alto", "part_label": "女低", "url": "https://xxx/api/files/...", "file_size": 980, "duration": 180 }
      ],
      "accompaniment": [
        { "id": "...", "type": "accompaniment", "part_name": "soprano", "part_label": "女高", "url": "https://xxx/api/files/...", "file_size": 900, "duration": 180 }
      ]
    }
  }
}
```

#### 3. 下载歌曲资源

```
GET /api/public/songs/:id/download
```

支持筛选参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `type` | 资源类型：`sheet` / `vocal` / `accompaniment` | `type=vocal` |
| `part_name` | 声部名称 | `part_name=soprano` |
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
      { "type": "vocal", "part_name": "soprano", "part_label": "女高", "url": "https://xxx/api/files/...", "file_size": 1024 }
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
- `Content-Disposition: attachment; filename*=UTF-8''茉莉花_范唱_女高.mp3`
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
