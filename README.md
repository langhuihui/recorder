# 🎵 歌曲管理 (Song Manager)

基于 Cloudflare Pages + R2 + D1 的歌曲管理应用，支持歌谱上传（图片/PDF自动转图片）、伴奏和范唱上传（最多4个声部）。

## 功能特性

- 📄 **歌谱管理** - 支持上传图片（JPG/PNG/WEBP）和 PDF 文件，PDF 自动转换为图片
- 🎹 **伴奏上传** - 支持高音/中音/次中音/低音 4 个声部
- 🎤 **范唱上传** - 支持高音/中音/次中音/低音 4 个声部
- 📡 **API 接口** - 提供歌曲列表和文件访问接口供其他程序调用
- 🎨 **现代 UI** - 暗色主题，响应式设计，拖拽上传

## 技术栈

- **运行时**: Cloudflare Pages Functions (Workers)
- **存储**: Cloudflare R2 (文件) + D1 (元数据)
- **前端**: 原生 HTML/CSS/JS (无框架依赖)
- **PDF 转换**: pdf.js (OffscreenCanvas)

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

创建数据库后，将返回的 `database_id` 更新到 `wrangler.jsonc` 中。

### 3. 执行数据库迁移

```bash
# 本地开发环境
pnpm db:migrate

# 远程生产环境
pnpm db:migrate:remote
```

### 4. 本地开发

```bash
pnpm dev
```

### 5. 部署

```bash
pnpm build
pnpm deploy
```

## API 接口

### 歌曲列表

```
GET /api/songs?page=1&limit=20
```

响应：
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "歌曲名称",
      "artist": "作者",
      "description": "描述",
      "created_at": "2025-01-01T00:00:00",
      "sheets": [
        { "id": "uuid", "url": "/api/files/songs/.../sheets/xxx.png", "sort_order": 0 }
      ],
      "tracks": [
        { "id": "uuid", "track_type": "accompaniment", "part_name": "soprano", "url": "/api/files/songs/.../audio/accompaniment/soprano.mp3" }
      ]
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
}
```

### 歌曲详情

```
GET /api/songs/:id
```

### 创建歌曲

```
POST /api/songs
Content-Type: application/json

{ "title": "歌曲名称", "artist": "作者", "description": "描述" }
```

### 上传文件

```
POST /api/songs/:id/upload
Content-Type: multipart/form-data

type: sheet | accompaniment | vocal
part_name: soprano | alto | tenor | bass (仅音频)
files: [文件]
```

### 访问文件

```
GET /api/files/{file_key}
```

支持 Range 请求（音频播放支持拖动进度条）。

### 删除歌曲

```
DELETE /api/songs/:id
```

### 重排歌谱

```
PUT /api/songs/:id/sheets/reorder
Content-Type: application/json

{ "order": ["sheet_id_1", "sheet_id_2", ...] }
```

## 项目结构

```
pages/
├── public/              # 前端静态文件
│   ├── index.html       # 页面
│   ├── style.css        # 样式
│   └── app.js           # 交互逻辑
├── functions/           # Cloudflare Pages Functions
│   └── api/
│       ├── songs.js              # 列表 & 创建
│       ├── songs/
│       │   ├── [id].js           # 详情/更新/删除
│       │   └── [id]/
│       │       ├── upload.js     # 文件上传
│       │       ├── sheets/
│       │       │   ├── reorder.js    # 歌谱排序
│       │       │   └── [sheetId].js  # 删除歌谱
│       │       └── tracks/
│       │           └── [trackId].js  # 删除音轨
│       └── files/
│           └── [[path]].js       # 文件访问
├── migrations/
│   └── 0001_init.sql    # 数据库迁移
├── wrangler.jsonc       # Wrangler 配置
├── package.json
└── README.md
```
