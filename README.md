# 榫卯结构拆解图鉴

面向传统木作学习者与家具设计人员的纯前端单页应用。项目把榫卯类型、构件尺寸、配合公差、拆装步骤、内联 SVG 示意图与适用家具整理为一套可查询、可编排、可追溯的本地图鉴，所有数据均保存在当前浏览器中。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

服务启动后访问：`http://localhost:21804`

停止服务：

```bash
docker compose down
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| UI | React 18、TypeScript 5 |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 路由 | React Router 6 |
| 状态 | Zustand 4 |
| 本地数据 | Dexie 4、IndexedDB |
| 容器 | Docker 多阶段构建、Nginx |

## 访问地址

- 宿主机端口：`21804`
- 页面地址：`http://localhost:21804`
- 前端路由回退由 Nginx 的 `try_files` 规则处理。

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

类型检查与生产构建：

```bash
cd frontend
npm run build
```

本地开发默认使用 Vite 的 `5173` 端口；应用数据由浏览器中的 Dexie 数据库维护，不需要后端服务。

## 目录结构

```text
.
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/common/   共享 SVG、步骤轨道、尺寸字段和标签
│   │   ├── hooks/               步序编排、尺寸录入、待核对与 SVG 热区解析
│   │   ├── pages/               图鉴、详情、步序、绘制台与家具反查
│   │   ├── router/              前端路由
│   │   ├── stores/              Zustand 状态与数据落库
│   │   ├── types/               核心数据模型（含并发编辑日志与待核对项）
│   │   ├── utils/               Dexie、合并引擎、排序键、待写队列、跨窗口同步、尺寸换算与 JSON 导出
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## 数据存储说明

应用使用 IndexedDB，数据库封装库为 Dexie 4，库名为 `gbmortise-db`。

- `version(1)`：建立 `joints`、`members`、`steps`、`diagrams`、`furniture` 五张表及查询索引。
- `version(2)`：执行升级迁移，为五张表回填 `schemaRev = 2` 字段。
- `version(3)`：多窗口并发编辑协作层。新增 `edits`（编辑日志）与 `reviews`（待核对项）两张表；为构件补记录版本水位 `revision` 与逐字段来源 `dimSources`，为步骤补小数排序键 `orderKey`、版本 `revision` 与最近移动来源 `lastMove`。旧库内容原样保留，仅回填新字段，升级后仍可正常查看与编辑。
- 首次创建数据库时通过 Dexie `populate` 回调写入榫卯、构件、步骤、内联 SVG 与家具关联的种子数据。
- 新建记录、尺寸修改、SVG 保存和步骤拖拽调序都会实时写回 IndexedDB，刷新页面后仍可读取。

### 多窗口同时编辑同一榫卯

两个浏览器窗口可同时打开同一项榫卯，系统按以下规则协作：

- **来源与基准位置**：每次尺寸修改都记录编辑窗口（`editorId` 与窗口名快照）、开始编辑时的基准值；每次步序移动记录来源窗口、原序号、目标序号与拖动前的排序键、前后锚点步骤。窗口身份保存在 `sessionStorage` 中（可在页首徽标处自定义名称），复制标签页时会通过握手自动换号。
- **按记录标识合并**：合并以构件 `memberId`、步骤 `stepId` 为键。不同尺寸字段（如甲改长、乙改厚）自动合并；不同步骤的移动使用 `orderKey` 中点定位，两边各自移动互不干扰。
- **同处冲突不覆盖**：同一尺寸字段或同一步骤被两个窗口基于不同基准改过时，后到的一方不会覆盖先落地方，而是在该榫卯页面生成“待核对”项，并列保留双方来源与方案，由师傅点选其一裁决；裁决动作同样写入编辑日志。
- **写库失败保留进度**：落库失败的修改进入 localStorage 待写队列并标记“待写库”，应用会定时重试；关闭后重新打开会自动读出并续传，进度不丢失。
- **跨窗口通知与兜底**：已落库的编辑通过 `BroadcastChannel` 通知其它窗口重读；错过广播的窗口在重新获得焦点或定时轮询时也会刷新待核对项并续传队列。
- 编辑日志与待核对项会随“导出全部数据 / 导出当前类型”一并导出。

## 核心功能与路由表

| 路由 | 页面 | 核心功能 |
| --- | --- | --- |
| `/` | 入口重定向 | 自动进入榫卯图鉴 |
| `/joints` | 榫卯图鉴总览 | 按家族与难度分组，新建类型，显示构件数与步骤数，导出全部数据 |
| `/joints/:id` | 类型详情 | 查看尺寸表、公差校验、适用家具与步骤；导出当前类型 |
| `/joints/:id/steps` | 拆装步序编排 | 原生拖拽调序并落库，逐步预览内联 SVG 与风险提醒 |
| `/joints/:id/diagram` | 示意图绘制台 | 点击热区回填构件，编辑构件名称、尺寸与 SVG 源 |
| `/furniture` | 家具榫卯反查 | 按家具聚合使用部位与承力说明，新建家具关联 |
