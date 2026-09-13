# SaveSync Cloud Saves — Steam Millennium Plugin

Plugin tích hợp tính năng Cloud Save trực tiếp vào giao diện Steam Client, đồng bộ 100% với Web App và cơ sở dữ liệu Ludusavi Manifest.

## Tính năng nổi bật
1. **Nút Thư viện Steam (Sidebar)**:
   - Dòng chữ `Cloud Saves` thanh lịch, ăn khớp với font chữ gốc của Steam.
2. **Hộp thoại Thao tác nhanh theo Game (Modal 1 - 660px)**:
   - Tự động nhận diện Game đang chọn trong Steam (bắt AppID, tên game).
   - Hiển thị Poster dọc từ Steam CDN.
   - Hiển thị song song dữ liệu Save trên máy và trên Cloud (kèm ngày giờ, dung lượng).
   - Huy hiệu trạng thái đồng bộ: Đã đồng bộ, Máy mới hơn, Cloud mới hơn...
   - Nút `☁ Sao Lưu` (Upload lên GitHub).
   - Nút `☁ Khôi Phục` (Download từ GitHub đè về máy, có Popup xác nhận cảnh báo an toàn).
   - Nút `Quản lý Save` (mở bảng danh sách tổng).
3. **Màn hình Quản lý Save (Modal 2 - 840px x 640px)**:
   - Danh sách toàn bộ game tìm thấy file save trên máy và trên Cloud (hơn 53.000 game từ Ludusavi).
   - Thanh tìm kiếm game theo tên tức thì.
   - 3 nút thao tác chuẩn Lucide:
     - `Sao lưu` (icon cloud-upload).
     - `Khôi phục` (icon cloud-download - có Popup xác nhận).
     - `Xóa` (icon trash-2 - xóa vĩnh viễn trên GitHub, có Popup xác nhận).

## Tính tương thích
- **Ludusavi:** Sử dụng chung chuẩn định dạng thư mục, biến môi trường (`%APPDATA%`, `%LOCALAPPDATA%`, `Saved Games`...) và cấu trúc file nén tương thích 100% với Ludusavi.
- **SaveSync Web App:** Dùng chung REST API Server (`localhost:3636`) và kho lưu trữ GitHub. Mọi thao tác sao lưu/khôi phục/xóa trên Steam Plugin đều phản hồi lập tức trên Web App và ngược lại.

## Cài đặt & Triển khai
Chạy file `deploy.bat` hoặc plugin đã được triển khai sẵn tại:
`C:\Program Files (x86)\Steam\millennium\plugins\savesync`
