# OmniRoute 3-instance setup

Thư mục này chứa cấu hình để chạy `3` instance `OmniRoute` song song và độc lập trên máy local.

## Cấu trúc

- `docker-compose.yml`: chạy cả 3 instance
- `Dockerfile.codex`: image custom chỉ dùng cho `omniroute-b`, có cài `Codex CLI`
- `.env.omniroute-a.example`: mẫu cấu hình cho instance A
- `.env.omniroute-b.example`: mẫu cấu hình cho instance B
- `.env.omniroute-c.example`: mẫu cấu hình cho instance C
- `.env.omniroute-a|b|c`: file cấu hình thật dùng để chạy container

## Port và URL

| Instance | Tên container | Port | URL |
| --- | --- | --- | --- |
| A | `omniroute-a` | `30120` | `http://localhost:30120` |
| B | `omniroute-b` | `30130` | `http://localhost:30130` |
| C | `omniroute-c` | `30140` | `http://localhost:30140` |

## Ghi chú về Codex CLI

- Chỉ `omniroute-b` được build bằng `Dockerfile.codex`
- Chỉ instance `B` có cài `Codex CLI`
- `omniroute-a` và `omniroute-c` vẫn dùng image upstream mặc định
- `omniroute-b` bind-mount thư mục host `/Users/youruser/Public/antigravity/one` vào `/workspace/one` để Codex có thể làm việc với project bên ngoài container
- `omniroute-b` mount file cấu hình Codex bền vững từ `OmniRoute/.codex/omniroute-b/config.toml` và `OmniRoute/.codex/omniroute-b/auth.json` vào `/root/.codex/` để không bị rơi về `api.openai.com` sau khi restart container

## Khởi động tất cả instance

Từ thư mục `OmniRoute`:

```bash
docker compose up -d
```

Lệnh này sẽ chạy đồng thời `omniroute-a`, `omniroute-b`, `omniroute-c`.

## Build lại riêng instance B có Codex CLI

Nếu bạn vừa sửa `Dockerfile.codex` hoặc muốn build lại image của instance B:

```bash
docker compose build omniroute-b
```

Sau đó chạy lại:

```bash
docker compose up -d omniroute-b
```

## Kiểm tra Codex CLI trong instance B

```bash
docker exec omniroute-b sh -lc 'command -v codex && codex --help >/dev/null'
```

Nếu lệnh trả về đường dẫn như `/usr/local/bin/codex` thì Codex CLI đã được cài thành công.

## Khởi động riêng từng instance

Nếu bạn chỉ muốn bật một instance cụ thể:

### Instance A

```bash
docker compose up -d omniroute-a
```

Truy cập tại:

```text
http://localhost:30120
```

### Instance B

```bash
docker compose up -d omniroute-b
```

Truy cập tại:

```text
http://localhost:30130
```

### Instance C

```bash
docker compose up -d omniroute-c
```

Truy cập tại:

```text
http://localhost:30140
```

## Cách dùng riêng từng instance

Mỗi instance là một OmniRoute độc lập hoàn toàn vì có:

- port riêng
- volume dữ liệu riêng
- file `.env` riêng
- tài khoản admin, provider, endpoint key, log và cấu hình riêng

Điều đó có nghĩa là:

- đăng nhập ở instance A **không dùng chung** với B/C
- provider bạn kết nối ở A **không tự xuất hiện** ở B/C
- API key tạo ở A **không dùng chung** với B/C

## Quy trình sử dụng một instance riêng

Ví dụ với instance B:

1. Khởi động riêng instance B:

```bash
docker compose up -d omniroute-b
```

2. Mở dashboard:

```text
http://localhost:30130
```

3. Đăng nhập bằng mật khẩu ban đầu trong file:

```text
OmniRoute/.env.omniroute-b
```

Biến cần dùng là:

```text
INITIAL_PASSWORD
```

4. Trong dashboard của instance B, cấu hình riêng:
   - `Providers`
   - `Endpoints`
   - `Combos`

5. Tạo API key riêng trong instance B.

6. Trỏ tool hoặc ứng dụng của bạn vào đúng instance B:

```text
Base URL: http://localhost:30130/v1
API Key: [API key tạo trong instance B]
```

7. Nếu cần kiểm tra Codex CLI trong container B:

```bash
docker exec -it omniroute-b sh
codex --help
```

8. Nếu muốn cho Codex làm việc với project trên máy Mac đã được mount vào container:

```bash
docker exec -it omniroute-b sh
cd /workspace/one
codex
```

Hoặc chạy nhanh một lệnh không tương tác:

```bash
docker exec omniroute-b sh -lc 'codex exec -C /workspace/one --skip-git-repo-check --sandbox danger-full-access "Reply with exactly OK"'
```

9. File cấu hình Codex bền vững của instance B nằm ở:

```text
OmniRoute/.codex/omniroute-b/config.toml
OmniRoute/.codex/omniroute-b/auth.json
```

`config.toml` giữ provider `omniroute` với `base_url` là `http://localhost:30130/v1`.
`auth.json` giữ API key của OmniRoute cho Codex và đang được ignore khỏi git.

10. Nếu Codex trong `omniroute-b` cần kiểm tra các container ở project Docker khác trên máy này, hiện tại đã có `shared Docker network` tên là `antigravity-shared`.

Từ trong `omniroute-b`, các service của project `one` đã được verify resolve trực tiếp bằng tên:

```text
postgres:5432
redis:6379
```

Ví dụ sử dụng:

```text
postgresql://one:***@postgres:5432/one
redis://redis:6379
```

Cách này hoạt động vì `omniroute-b` đã join network `antigravity-shared`, còn `one` stack đã gắn `postgres` và `redis` vào cùng network đó với alias ổn định là `postgres` và `redis`.

Nếu cần kiểm tra các service khác chưa được gắn alias trên shared network, bạn vẫn có thể dùng host port qua `host.docker.internal`, ví dụ:

```text
postgresql://one:***@host.docker.internal:3101/one
redis://host.docker.internal:3102
postgresql://postgres:***@host.docker.internal:5433/[db-timescaledb]
postgresql://postgres:***@host.docker.internal:5434/[db-external-signal]
redis://host.docker.internal:6379
```

Lưu ý: hiện tại chỉ các service đã được gắn vào shared network với alias tương ứng mới resolve trực tiếp bằng tên từ `omniroute-b`.

Bạn có thể làm tương tự với instance A hoặc C bằng cách đổi port tương ứng, nhưng A/C sẽ không có Codex CLI trừ khi bạn cài thêm riêng cho chúng.

## Codex local trên máy Mac với profile tách biệt

Ngoài `Codex CLI` chạy trong `omniroute-b`, máy Mac hiện có thể chạy `Codex` trực tiếp bằng binary host tại:

```text
/usr/local/bin/codex
```

Để tách biệt hoàn toàn auth, config, history và thư mục làm việc mặc định, tôi đã tạo `3` launcher local:

```text
/Users/youruser/bin/codex-trade
/Users/youruser/bin/codex-one
/Users/youruser/bin/codex-lab
```

Mỗi launcher sẽ tự động:

- đổi `HOME` sang profile riêng trong `~/codex-profiles/.../home`
- dùng `.codex` riêng cho từng profile
- dùng `.zsh_history` riêng cho từng profile
- chuyển vào đúng project mặc định trước khi mở `codex`

Các profile hiện có:

```text
/Users/youruser/codex-profiles/trade/home/.codex
/Users/youruser/codex-profiles/one/home/.codex
/Users/youruser/codex-profiles/lab/home/.codex
```

Cách dùng:

```bash
~/bin/codex-trade
~/bin/codex-one
~/bin/codex-lab
```

Login của từng launcher là độc lập. Nghĩa là bạn có thể đăng nhập `account Codex` khác nhau cho từng profile mà không ghi đè lẫn nhau.

Config khởi tạo sẵn của mỗi profile nằm trong `config.toml` tương ứng và hiện đang trỏ mặc định tới OmniRoute B (`http://localhost:30130/v1`). Nếu muốn, bạn có thể đổi từng profile sang provider hoặc base URL khác mà không ảnh hưởng profile còn lại.

## Ví dụ mục đích dùng riêng

- `omniroute-a`: dùng cho test provider miễn phí
- `omniroute-b`: dùng cho agent/công cụ chính có tích hợp `Codex CLI`
- `omniroute-c`: dùng cho thử nghiệm cấu hình khác hoặc API key khác

## Dừng dịch vụ

### Dừng toàn bộ

```bash
docker compose down
```

### Dừng riêng một instance

```bash
docker compose stop omniroute-a
```

Đổi thành `omniroute-b` hoặc `omniroute-c` khi cần.

## Khởi động lại một instance

```bash
docker compose restart omniroute-a
```

Đổi `omniroute-a` thành `omniroute-b` hoặc `omniroute-c` khi cần.

## Xem trạng thái

### Xem toàn bộ

```bash
docker compose ps
```

### Xem riêng một instance

```bash
docker compose ps omniroute-b
```

## Xem log

### Xem log toàn bộ

```bash
docker compose logs --tail=100
```

### Xem log riêng một instance

```bash
docker compose logs --tail=100 omniroute-c
```

## Theo dõi RAM

### Xem cả 3 instance

```bash
docker stats --no-stream omniroute-a omniroute-b omniroute-c
```

### Xem riêng một instance

```bash
docker stats --no-stream omniroute-b
```

## File cấu hình quan trọng

- `OmniRoute/.env.omniroute-a`
- `OmniRoute/.env.omniroute-b`
- `OmniRoute/.env.omniroute-c`

Nếu muốn đổi:

- mật khẩu admin ban đầu
- tên instance
- base URL
- secret key
- OAuth secret

thì sửa file `.env` tương ứng rồi khởi động lại instance đó.

Ví dụ:

```bash
docker compose restart omniroute-b
```

## Khi nào cần dùng từng URL API

- Dashboard web:
  - `http://localhost:30120`
  - `http://localhost:30130`
  - `http://localhost:30140`
- OpenAI-compatible API:
  - `http://localhost:30120/v1`
  - `http://localhost:30130/v1`
  - `http://localhost:30140/v1`

## Ghi chú

- Mỗi instance có volume riêng nên dữ liệu tách biệt hoàn toàn.
- Các file `.env.omniroute-a|b|c` được ignore khỏi git vì có chứa secret local.
- Nếu sau này expose ra internet, bạn có thể cần tự cấu hình OAuth redirect cho một số provider như Gemini hoặc Antigravity.
