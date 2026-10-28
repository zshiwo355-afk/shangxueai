# 怀仁商学院 · ShangxueAI

销售对练 / 在线考试 / 课程学习 一体化训练平台。

技术栈：**FastAPI + SQLAlchemy(async) + MySQL** · **React 19 + Ant Design 6 + Vite 8** · **MaxKB（规则与知识库）** · **OpenAI 兼容协议 LLM** · **阿里云 OSS（视频存储）**。

---

## 项目结构

```
ShangxueAI/
├── 02_项目实现方案/        # 6 份方案文档（V1 设计 → V2 实现）
├── backend/                # FastAPI 后端
│   ├── app/                # 业务代码（auth / training / exams / papers / magic_academy / materials …）
│   ├── sql/                # 建表与索引脚本
│   │   ├── full_install.sql        # 全量建库（首次部署用）
│   │   ├── shangxueai.sql          # 历史导出参考
│   │   ├── legacy_db_sync.sql      # 历史库结构对齐脚本
│   │   └── performance_indexes.sql # 性能索引（增量执行）
│   ├── scripts/
│   │   ├── run.bat         # Windows 开发启动
│   │   ├── run_prod.bat    # Windows 生产启动
│   │   └── run_prod.sh     # Linux 生产启动
│   ├── uploads/            # 本地上传暂存（OSS 直传前的临时区）
│   ├── requirements.txt
│   └── .env.example
└── frontend/               # React 前端（Ant Design 6 + Vite）
    ├── src/
    │   ├── App.jsx                 # 路由表（路由级懒加载）
    │   ├── components/             # 各页面组件
    │   ├── lib/                    # API/auth/notify/storage 工具
    │   ├── styles.css              # 全局样式（已按 className 引用裁剪）
    │   ├── antdTheme.js            # Ant Design token 主题
    │   └── main.jsx
    ├── vite.config.js              # 已配置 manualChunks 分包
    ├── package.json
    └── .env.example
```

---

## 前置条件

1. **MySQL 8.0+**：本地或远程实例，默认 DSN `mysql+aiomysql://root:123@127.0.0.1:3306/shangxueai`。先执行 `backend/sql/full_install.sql` 建库建表，再执行 `backend/sql/performance_indexes.sql` 加索引。
2. **MaxKB**：在后台创建知识库，导入项目所需的 Markdown 规则与产品知识（详见 `02_项目实现方案/05_MaxKB接入与规则加载方案.md`），拿到 `kb_id` 与 API Key。
3. **LLM**：默认走 ofox 网关 OpenAI 兼容协议，准备好 API Key。也可以指向任何 OpenAI 兼容端点（vllm / 阿里灵积 / 自托管 …）。
4. **阿里云 OSS（可选）**：仅在需要"魔学院视频上传"功能时配置；不配置时课程视频不可上传，其它功能不受影响。

---

## 启动后端

### Windows（开发）

```powershell
cd backend
copy .env.example .env
# 编辑 .env：MaxKB / LLM / DB_DSN / JWT_SECRET / SUPER_ADMIN_* 等

# 建议使用虚拟环境
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 启动（自动识别 .venv，监听 8000 端口）
scripts\run.bat
```

### Linux / 生产

```bash
cd backend
cp .env.example .env  # 然后填写
python -m venv .venv && .venv/bin/pip install -r requirements.txt
bash scripts/run_prod.sh
```

后端默认监听 `http://127.0.0.1:8000`。

- 健康检查：`GET /api/health`
- 规则预热：服务启动时自动加载；手动触发 `POST /api/rules/reload`
- 启动时若数据库中没有任何超级管理员，会按 `.env` 里的 `SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD / SUPER_ADMIN_NAME` 自动创建一个

---

## 启动前端

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 已经把 `/api` 代理到 `127.0.0.1:8000`。

### 生产构建

```powershell
npm run build         # 产物输出到 frontend/dist
```

后端 `app/main.py` 会按以下顺序自动挂载 `dist/`：

1. 环境变量 `FRONTEND_DIST_PATH`
2. `<repo>/frontend/dist`
3. `<backend>/../dist`
4. `<backend>/dist`

也就是说生产环境直接把 `frontend/dist` 留在仓库里，后端就会以 SPA 方式托管前端，无需另外起 nginx。

---

## 关键能力

| 模块 | 路径前缀 | 说明 |
|---|---|---|
| 鉴权 | `/api/auth/*` | JWT 登录、`/me`、登出。密码 MD5 存储 |
| 选项与白名单 | `/api/options/*`、`/api/whitelist/*` | 训练类型 / 难度 / 客户类型；超级管理员维护白名单 |
| 销售对练 | `/api/training/*` | 启动对话 → 单轮聊天 → 复盘；带状态机与硬性轮次校验 |
| 训练记录 | `/api/training/records/*` | 历史记录列表、详情、删除 |
| AI 通关考试 | `/api/exams/*` | 派发任务、考试入口、提交、复核 |
| 试卷考试 | `/api/papers/*`、`/api/paper-assignments/*`、`/api/question-bank/*`、`/api/question-imports/*` | 题库、试卷、派发、Excel/Word 导入、提交 |
| 魔学院（课程） | `/api/magic-academy/*` | 课程视频、阅读、学习记录、白名单视频 |
| 素材库 | `/api/materials/*` | 文件夹与素材资产管理（视频 / 图片 / 文档） |
| 规则重载 | `/api/rules/reload` | 清缓存重新预热 MaxKB 规则 |

---

## 积分商城

- 员工入口：用户导航「积分商城」（`/mall`）。默认展示排在首位的「全部」，可切换「可兑换」；同时提供可用余额、累计积分前十及固定的个人排名、兑换记录和领取码。
- 管理员入口：「运营激励 → 积分兑换」（`/admin/mall`）中的「商城积分 / 商品管理 / 兑换记录」。可搜索已有员工发分、维护商品及库存、核对领取人和领取码后核销。原学习排行、流水和规则单独保留在「运营激励 → 学习积分」（`/admin/points`）。
- 商城积分从零开始，只由管理员发放，与学习积分独立。管理员按正整数填写商品「兑换积分」，员工商城按 1 积分对应 20 元显示金额，例如填写 5 积分，商城显示 100 元。兑换每次 1 件，立即扣余额和库存，累计积分及排名不因消费减少；员工到前台领取，无邮寄或现金支付流程。
- 兑换记录保留商品名称、成交价格和扣分的快照。发分与兑换支持同一请求重试防重，商品编辑校验版本，核销记录保留操作人和时间。
- 员工在商城顶部发送共享留言，实名纯文字弹幕在整个商城可视区域错落飘过，通常同屏约 10 条，小视口按可用高度减少数量，出现高度、时间和速度随机。电脑悬停暂停单条、移开恢复；手机点按单条可切换暂停和继续，其他弹幕照常播放。自己的弹幕显示「我：内容」并以青绿色突出，服务端按登录账号判断，刷新后仍保留标识。弹幕间的空白区域可以正常操作商城。循环播放最新 100 条，刷新后保留。免费发送、不扣积分，每条 1–50 字、每个账号间隔至少 5 秒；新消息优先显示，无需等待历史消息循环结束，单条暂停的弹幕不会被替换，其他员工页面约 5 秒同步。支持全部暂停阅读，并遵循系统减少动态效果的设置。
- **已有数据库升级使用增量脚本**：`backend/sql/points_mall.sql` 创建四张商城表，`backend/sql/mall_danmaku.sql` 新增弹幕表；都可重复执行，不清空已有积分或用户。已上线商城仅新增弹幕时执行后者。不要重新执行含 `DROP TABLE` 的全量安装脚本。首次安装已包含在 `full_install.sql` 中。部署时先执行增量 SQL，再发布后端和前端构建。
- 本地商品图片上传复用已有 OSS 配置，要求 HTTPS 公网地址；也可填写 HTTPS 图片地址或从素材库选图。未配置 OSS 时仍可使用无图商品。

商城检查（在 `backend` 目录）：

```bash
.venv/bin/python -m unittest discover -s tests -p test_mall.py -v
# 使用独立的本地测试库；该测试会清空指定 mall_test_* 库内的测试表。
MALL_TEST_DB_DSN='mysql+aiomysql://USER:PASSWORD@127.0.0.1:3306/mall_test_checks' \
  .venv/bin/python -m unittest discover -s tests -p test_mall_mysql.py -v
```

前端检查（在 `frontend` 目录）：

```bash
node --test src/components/mall/mall-utils.test.js src/components/admin/points/mall-admin-utils.test.js
npm run build
```

## 角色

| 角色 | 入口 | 能力 |
|---|---|---|
| `user` | `/home` 用户门户 | 销售对练、参加考试、看课程、看记录 |
| `admin` | `/admin` 管理后台 | 选项、用户、AI 通关派发、试卷管理、课程管理、素材库 |
| `super_admin` | `/admin` + 白名单 | 在 admin 基础上多一个白名单管理 tab |

启动时若数据库无超管，由 `.env` 中的 `SUPER_ADMIN_*` 自动播种。

---

## 前端性能策略

- **路由级懒加载**：所有页面通过 `React.lazy` + `Suspense` 按需加载，登录页首屏只下载入口 chunk + react/antd/router 框架。
- **manualChunks 分包**：`antd` / `@ant-design/icons` / `react-router` / `dayjs` / `react-markdown` 各自独立 chunk，提升二次访问命中率。
- **ChatPage 智能跟随**：用户上滑查看历史时不被新消息强行拽到底，回到底部后自动恢复跟随。
- **派生数据 memo 化**：HomePage / ChatMessage 等高频更新组件加 `useMemo` / `React.memo`，LiveClock 每秒滴答不再触发整树过滤重算。
- **搜索 debounce**：素材选择器 / 视频派发选材搜索框 250ms debounce，避免按一键打一次接口。
- **CSS 体积**：`styles.css` 经过引用扫描裁剪，移除约 200 条历史改版后未使用的规则；打包后 CSS 从 ~93 kB → ~72 kB（−22%）。
- **Skeleton 占位**：训练记录列表初始展示骨架卡，避免"切页一闪"。

---

## 开发约定

- **数据库不在代码里建表**：所有 schema 变更走 `backend/sql/`，ORM 仅做映射。
- **API 全部禁用浏览器缓存**：`/api/*` 响应统一带 `Cache-Control: no-store`。
- **前端 401 自动跳转登录**：`lib/auth.js` 在 fetch 拦截层处理。
- **错误兜底**：所有未捕获 Promise rejection 走统一 toast（见 `main.jsx` 的 `MessageBridge`）。

---

## 文档

| 文件 | 说明 |
|---|---|
| `02_项目实现方案/01_整体实现方案_FastAPI_React_MaxKB.md` | 总体技术方案 |
| `02_项目实现方案/02_后端接口设计.md` | 全部接口契约 |
| `02_项目实现方案/03_后端状态机与数据结构.md` | 训练状态机、评分逻辑、数据建模 |
| `02_项目实现方案/04_前端页面设计.md` | 页面结构与交互流程 |
| `02_项目实现方案/05_MaxKB接入与规则加载方案.md` | 知识库导入与规则装配流程 |
| `02_项目实现方案/06_开发排期.md` | 里程碑与排期 |

---

## 常见问题

**前端启动报 `cannot find module '@vitejs/plugin-react'`**
跑一次 `npm install`，然后 `npm run dev`。

**后端启动 `MAXKB_BASE_URL field required`**
忘了 `cp .env.example .env` 或没填必填项。`MAXKB_BASE_URL` 是必填。

**首次进入后台没有数据**
默认 `full_install.sql` 不带任何样例数据，需要登录超管账号在 `/admin` 里创建训练类型、难度、白名单视频等。

**考试派发后用户看不到任务**
检查派发对象（`paper_assignments`）的 `start_at / end_at` 是否覆盖当前时间，以及用户与课程的白名单匹配是否正确。

**视频上传失败**
检查 `OSS_*` 全部环境变量；本地开发可以先不配置 OSS，但魔学院视频上传会不可用。
