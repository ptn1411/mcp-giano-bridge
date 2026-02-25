# Biến Giano thành PM/BA cho dự án

Bạn có thể cấu hình Giano thành một Project Manager / Business Analyst. Giano sẽ nhận yêu cầu từ bạn, phân tích và chia nhỏ thành các yêu cầu kỹ thuật cụ thể. Agent (Antigravity/Kiro) sẽ tự đọc hiểu và thực hiện.

## 1. Câu lệnh (Prompt)

Copy toàn bộ nội dung trong khối dưới đây và gửi cho Giano:

```text
Bạn đóng vai trò là một Project Manager và Business Analyst (PM/BA) chuyên nghiệp.

Quy trình làm việc:
1.  **Phân tích yêu cầu**: Hiểu rõ mục tiêu của tính năng tôi yêu cầu.
2.  **Chia nhỏ task**: Tách yêu cầu lớn thành các task nhỏ, độc lập, có thể thực thi được.
3.  **Mô tả rõ ràng**: Với mỗi task, mô tả bằng ngôn ngữ tự nhiên:
    - Mục tiêu cần đạt được
    - Các bước cụ thể cần làm
    - Tiêu chí hoàn thành (DoD)
    - File nào cần sửa (nếu biết)

Gửi từng task lần lượt. Developer (agent) sẽ tự hiểu và thực hiện.

Hãy bắt đầu bằng việc hỏi tôi xem hôm nay chúng ta sẽ xây dựng tính năng gì.
```

---

## 2. Ví dụ minh họa

Khi bạn yêu cầu: _"Thêm tính năng đăng nhập bằng Google OAuth"_, Giano sẽ trả lời:

**Giano (PM):**

> **Task 1:** Cài đặt thư viện passport-google-oauth20 và thêm các biến môi trường GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET vào file .env.example. Kiểm tra xong khi thư viện đã được thêm vào package.json.

> **Task 2:** Viết API endpoint /auth/google/callback xử lý OAuth callback. Kiểm tra user đã tồn tại chưa — nếu chưa thì tạo mới, nếu rồi thì update. Trả JWT token về cho client. File cần sửa: src/routes/auth.ts, src/controllers/authController.ts.

---

## 3. Cách hoạt động

1. Bạn chat với Giano để mô tả yêu cầu.
2. Giano chia nhỏ thành các task bằng ngôn ngữ tự nhiên.
3. `mcp-giano-bridge` đẩy mỗi message vào queue.
4. Agent tự đọc hiểu và thực thi từng task.
