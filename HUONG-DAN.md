# Claude Usage Dashboard - Hướng Dẫn Sử Dụng

---

## 1. TỔNG QUAN (Overview)

Tool này giúp theo dõi **usage quota** của nhiều tài khoản Claude.ai cùng lúc.

**Cách hoạt động:**
- Chạy trên VPS dưới dạng Docker container
- Dùng Playwright (headless browser) để scrape dữ liệu từ claude.ai
- Tự động refresh dữ liệu mỗi **1 phút**
- Dashboard web chạy ở port **4455**

**Yêu cầu:**
- VPS có cài Docker & Docker Compose
- Các tài khoản Google đã có Claude.ai

---

## 2. CÀI ĐẶT LẦN ĐẦU (Initial Setup)

### 2.1 Clone project lên VPS

```bash
git clone <repo-url> claude-usage-dashboard
cd claude-usage-dashboard
```

### 2.2 Tạo file `.env`

Copy file mẫu rồi chỉnh sửa:

```bash
cp .env.example .env
nano .env
```

Nội dung `.env`:

```env
PORT=4455
ACCOUNT_COUNT=4
ACCOUNT_1_NAME=Gmail Account 1
ACCOUNT_2_NAME=Gmail Account 2
ACCOUNT_3_NAME=Gmail Account 3
ACCOUNT_4_NAME=Gmail Account 4
```

> Đặt tên gợi nhớ cho từng account, ví dụ: `ACCOUNT_1_NAME=Nguyen Van A`

### 2.3 Build Docker image

```bash
docker compose build
```

---

## 3. LOGIN TÀI KHOẢN (Setup Session)

Mỗi tài khoản Google cần được login **một lần** để lưu session. Sau đó tool tự scrape mà không cần login lại.

### Tổng quan quy trình login:

```
VPS (Docker + VNC server)  <-->  Local machine (VNC viewer)
                                  -> Mở Chrome trên VPS
                                  -> Login Google qua VNC
```

### 3.1 Trên VPS - Chạy script setup

SSH vào VPS, chạy lệnh này để bắt đầu setup account (ví dụ account số 1):

```bash
./setup-on-vps.sh 1
```

Script sẽ hiện hướng dẫn và **password VNC**: `vnc1234`

### 3.2 Trên máy LOCAL - Tạo SSH tunnel

Mở terminal mới trên máy local:

```bash
ssh -L 5900:localhost:5900 <user>@<vps-ip>
```

> Ví dụ: `ssh -L 5900:localhost:5900 ubuntu@123.456.789.0`

Giữ terminal này mở trong suốt quá trình setup.

### 3.3 Trên máy LOCAL - Kết nối VNC

---

## 4. SỬ DỤNG VNC

### 4.1 Cài VNC Viewer

- **macOS**: [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/) hoặc dùng `brew install tiger-vnc`
- **Windows**: [TightVNC](https://www.tightvnc.com/) hoặc [RealVNC](https://www.realvnc.com/)
- **Linux**: `sudo apt install tigervnc-viewer`

### 4.2 Kết nối

Mở VNC Viewer và kết nối tới:

```
Host: localhost:5900
Password: vnc1234
```

> Dùng `localhost` vì đã có SSH tunnel ở bước 3.2

### 4.3 Login Google trong VNC

Sau khi kết nối VNC, bạn sẽ thấy Chrome đang mở trang `claude.ai/login`:

1. Click **Continue with Google**
2. Chọn hoặc nhập tài khoản Google
3. Nhập mật khẩu, hoàn tất 2FA nếu có
4. Đợi redirect về trang Claude dashboard (`claude.ai/...`)

### 4.4 Xác nhận login xong

Quay lại terminal VPS (nơi đang chạy `setup-on-vps.sh`), nhấn **Enter** để xác nhận.

Script sẽ tự động lưu cookies vào:
```
sessions/account-1/cookies.json
```

### 4.5 Lặp lại cho các account khác

```bash
./setup-on-vps.sh 2
./setup-on-vps.sh 3
./setup-on-vps.sh 4
```

Mỗi account cần một lần SSH tunnel + VNC riêng.

---

## 5. KHỞI ĐỘNG DASHBOARD

Sau khi đã login đủ accounts:

```bash
docker compose up -d
```

Truy cập dashboard tại:

```
http://<vps-ip>:4455
```

**Kiểm tra logs:**

```bash
docker compose logs -f
```

---

## 6. KẾT NỐI VPS TỪ BÊN NGOÀI

### 6.1 SSH thông thường

```bash
ssh <user>@<vps-ip>
```

Ví dụ: `ssh ubuntu@123.456.789.0`

### 6.2 Xem dashboard từ ngoài

Nếu VPS mở port 4455, truy cập thẳng:

```
http://<vps-ip>:4455
```

Nếu muốn truy cập qua SSH tunnel (bảo mật hơn, không cần mở port):

```bash
ssh -L 4455:localhost:4455 <user>@<vps-ip>
```

Rồi mở: `http://localhost:4455`

---

## 7. CÁC LỆNH THƯỜNG DÙNG

| Lệnh | Mô tả |
|------|-------|
| `docker compose up -d` | Khởi động dashboard (background) |
| `docker compose down` | Dừng dashboard |
| `docker compose logs -f` | Xem logs realtime |
| `docker compose restart` | Restart |
| `./setup-on-vps.sh <n>` | Setup/re-login account thứ n |

---

## 8. XỬ LÝ SỰ CỐ

**Dashboard không load dữ liệu:**
- Check logs: `docker compose logs -f`
- Có thể session hết hạn → chạy lại `setup-on-vps.sh <n>`

**Không kết nối được VNC:**
- Đảm bảo SSH tunnel đang chạy (bước 3.2)
- Đúng port `5900`
- Đúng password `vnc1234`

**Account bị logout:**
- Chạy lại `./setup-on-vps.sh <số account>` để login lại

---

## 9. SƠ ĐỒ TỔNG QUAN

```
Máy Local
  │
  ├─ SSH Tunnel ──────────────────> VPS
  │  (port 5900 / 4455)              │
  │                                  ├─ Docker Container
  │                                  │    ├─ Playwright (scraper)
  │                                  │    ├─ Web server :4455
  │                                  │    └─ VNC server :5900
  │                                  │
  │                                  └─ sessions/ (lưu cookies)
  │
  ├─ VNC Viewer ──> localhost:5900 -> Chrome trên VPS
  └─ Browser ─────> localhost:4455 -> Dashboard
```
