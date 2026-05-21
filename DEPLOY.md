# 部署指南（DEPLOY.md）

把项目部署到一台服务器（Linux 或 Windows 均可），最小可工作组合：
**MySQL 8 + Python 3.11+ + FastAPI（同时托管前端 dist）**。无需额外 nginx 也能跑。

---

## 一、需要打包上传的文件清单

打成压缩包发到服务器，包含以下内容（**不要**包含 `node_modules/` 和 `.venv/`）：

```
shangxue-deploy/
├── backend/
│   ├── app/                      # 后端 Python 源码
│   ├── scripts/
│   │   ├── run_prod.sh           # Linux 生产启动脚本
│   │   └── run_prod.bat          # Windows 生产启动脚本
│   ├── sql/
│   │   └── full_install.sql      # 一键建库（含 admin/123456 种子）
│   ├── requirements.txt
│   ├── .env                      # 生产配置（含真实凭证，私密！）
│   └── uploads/                  # 用户上传根目录（首次启动会自动建子目录，但保留这一层）
└── frontend/
    └── dist/                     # 前端打包产物（FastAPI 会托管它）
        ├── index.html
        └── assets/
```

> ⚠️ `backend/.env` 含 OSS / LLM / MaxKB 真实凭证 + JWT 密钥，传输和存储都要注意权限（建议 600）。

---

## 二、服务器一次性准备

### 1. 安装运行时

**Linux**（CentOS / Ubuntu）：

```bash
# Python 3.11+
sudo apt install -y python3 python3-venv python3-pip   # Ubuntu
# 或
sudo yum install -y python3 python3-pip                # CentOS

# MySQL 8 + 创建数据库（任一方式）
mysql -uroot -p
CREATE DATABASE shangxueai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

**Windows Server**：装好 Python 3.11+ 和 MySQL 8 即可。

### 2. 导入数据库

```bash
# Linux / 直接执行（最稳）
mysql -uroot -p shangxueai < /path/to/backend/sql/full_install.sql

# 或在 mysql> 里：
mysql> SOURCE /path/to/backend/sql/full_install.sql;
```

执行完后会有：
- 默认管理员账号：**admin / 123456**（生产请尽快登录后改密码或 SQL 改 `password_md5`）
- 三类下拉项的种子数据

### 3. 安装 Python 依赖

```bash
cd backend

# Linux
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Windows
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

---

## 三、生产配置（部署前必改）

打开 `backend/.env`，至少检查 / 修改以下三项：

| key | 怎么改 |
|---|---|
| `DB_DSN` | 改成服务器上的 MySQL 用户名/密码/host：`mysql+aiomysql://USER:PASS@127.0.0.1:3306/shangxueai?charset=utf8mb4` |
| `JWT_SECRET` | 必改！生成一个 32+ 位随机字符串。当前默认值是占位符，不改的话 token 不安全 |
| `ALLOWED_ORIGINS` | 加上你服务器对外的访问地址，例如 `http://你的IP:8000,https://你的域名` |

`OSS_*` / `MAXKB_*` / `LLM_*` 已经有真实值，按需求确认是否要换 key。

---

## 四、启动

### Linux

```bash
cd backend
chmod +x scripts/run_prod.sh
bash scripts/run_prod.sh
```

或后台 systemd（更推荐生产）：

```ini
# /etc/systemd/system/shangxueai.service
[Unit]
Description=ShangxueAI
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/shangxueai/backend
Environment=HOST=0.0.0.0
Environment=PORT=8000
Environment=WORKERS=4
ExecStart=/opt/shangxueai/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips=*
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shangxueai
sudo systemctl status shangxueai
```

### Windows Server

```bat
cd backend
scripts\run_prod.bat
```

后台跑可以用 NSSM 注册成服务。

---

## 五、验证

启动后浏览器打开：

- `http://服务器IP:8000/` → 看到登录页 = 前端 OK
- `http://服务器IP:8000/api/health` → `{"status":"ok"}` = 后端 OK
- 用 `admin / 123456` 登录 → 进入管理后台 = 数据库 OK

---

## 六、可选：放在 Nginx 后面

直跑 FastAPI 即可对外，但生产建议套一层 Nginx 做 HTTPS / 限流 / 静态资源缓存：

```nginx
server {
    listen 80;
    server_name your.domain.com;

    client_max_body_size 200m;   # 视频/录音上传

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

---

## 七、常见问题

**1. 前端能开但所有接口报 "下拉项加载失败 / HTML 200"**
后端没起来，或前端 dist 是老版本（缓存）。两端都已写了 `Cache-Control: no-store`，硬刷新（Ctrl+Shift+R）一次即可。新版浏览器进入后不会再发生。

**2. 上传视频/录音 413 / 体积超限**
Nginx 的 `client_max_body_size`（默认 1M）。改大并 `nginx -s reload`。

**3. 重启 systemd 后 magic-academy 视频流 404**
检查 `backend/uploads/magic_academy/videos/` 目录权限，确保 uvicorn 进程 user 可读写。`run_prod.sh` 启动时会自动 mkdir，但权限取决于运行身份。

**4. 修改了 .env 不生效**
配置用了 `lru_cache`，必须重启进程：`systemctl restart shangxueai`。

**5. 升级时数据库怎么处理**
- **新装库**：用 `full_install.sql`，不要再叠加 `migrate_*.sql`
- **老库升级**：按版本顺序单独跑 `sql/migrate_v*.sql`，不要执行 `full_install.sql`（含 DROP，会清空数据）
