# SaveSync Desktop (WPF / .NET 8)

> Ứng dụng Desktop hiện đại (C# / .NET 8 WPF) quản lý và tự động đồng bộ save game lên kho lưu trữ cá nhân (private) GitHub dựa trên dữ liệu manifest từ **Ludusavi**.

---

## 🌟 Tính năng nổi bật

- **Giao diện hiện đại Windows 11 Fluent**: Sử dụng thư viện WPF-UI, hỗ trợ Mica Backdrop, Dark Mode và các hiệu ứng động mượt mà.
- **Khay hệ thống (System Tray)**:
  - Ứng dụng chạy nền trên Taskbar Notification Area với icon đẹp.
  - Thu nhỏ xuống khay khi đóng hoặc khởi động ẩn với cờ `--minimized`.
  - Context menu thao tác nhanh: Mở giao diện, Đồng bộ tất cả (Sync All), Thoát hoàn toàn (Exit).
- **Nhận diện Save Game thông minh (Ludusavi Manifest)**:
  - Tự động nhận diện đường dẫn save của hàng nghìn tựa game trên Windows (`%APPDATA%`, `%LOCALAPPDATA%`, `Saved Games`, Documents, v.v.).
  - Tích hợp thông tin Steam App ID và Poster hình ảnh game.
- **Lưu trữ bảo mật trên GitHub riêng tư (Private Repo)**:
  - Sử dụng GitHub REST API trực tiếp từ C#.
  - Token được lưu cục bộ trên máy (`.env` hoặc `appsettings.json`), không qua bất kỳ máy chủ trung gian nào.
- **Đóng gói ZIP & Toàn vẹn dữ liệu (SHA-256)**:
  - Nén save game thành file ZIP kèm metadata ánh xạ đường dẫn tương đối.
  - So khớp checksum SHA-256 để xác định chính xác trạng thái: `Synced`, `LocalNewer`, `RemoteNewer`, `LocalOnly`, `RemoteOnly`.
- **Tự động đồng bộ khi đóng game (GameWatcherService)**:
  - Tự động phát hiện khi game kết thúc để đồng bộ save mới nhất lên đám mây.

---

## 🚀 Khởi chạy & Sử dụng

### 1. Khởi chạy nhanh
Chỉ cần nhấp đúp vào:
```
Run-SaveSync.bat
```
File này sẽ tự động tìm bản build sẵn (Publish / Release / Debug) hoặc khởi chạy bằng `dotnet run`.

### 2. Cấu hình GitHub Token
Mở tab **Cài đặt** (Settings) trong ứng dụng hoặc tạo file `.env` tại thư mục gốc:

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=username_cua_ban
GITHUB_REPO=ten_repo_chua_save
```

---

## 🛠️ Hướng dẫn Biên dịch (Build & Publish)

### Yêu cầu
- Windows 10/11
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) hoặc mới hơn
- Visual Studio 2022 / Rider / VS Code (tùy chọn)

### 1. Mở dự án trong Visual Studio
Mở file `SaveSync.sln` hoặc `SaveSync.slnx` ở thư mục gốc.

### 2. Build dự án từ dòng lệnh
```powershell
# Biên dịch chế độ Release
dotnet build SaveSync.sln -c Release
```

### 3. Xuất bản thành file EXE duy nhất (Single-file Executable)
```powershell
dotnet publish SaveSync.Wpf/SaveSync.Wpf.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
```
File thực thi độc lập sẽ được tạo tại `publish/SaveSync.Wpf.exe`.

---

## 📂 Cấu trúc mã nguồn

```
├── SaveSync.sln            # Solution Visual Studio
├── SaveSync.slnx           # Solution định dạng hiện đại
├── Run-SaveSync.bat        # Launcher khởi động nhanh
├── .env                    # Cấu hình GitHub credentials (cục bộ)
├── assets/                 # Icon và hình ảnh ứng dụng
├── data/
│   ├── cache/              # Cache manifest Ludusavi và poster games
│   └── manifest/           # Dữ liệu gốc Ludusavi
├── publish/                # File thực thi đã xuất bản
└── SaveSync.Wpf/           # Toàn bộ mã nguồn WPF Desktop (.NET 8)
    ├── Models/             # Mô hình dữ liệu (GameEntry, AppSettings, v.v.)
    ├── Services/           # Xử lý Logic (GitHub, Backup, Restore, Scanner, Watcher, Manifest)
    ├── ViewModels/         # MVVM ViewModels (CommunityToolkit.Mvvm)
    ├── Views/              # Giao diện XAML (MainWindow, Pages, Dialogs)
    └── Converters/         # XAML Value Converters
```
