using CommunityToolkit.Mvvm.ComponentModel;

namespace SaveSync.Desktop.Models;

public partial class DetectedGame : ObservableObject
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int? SteamId { get; set; }

    public string? SteamBannerUrl => SteamId.HasValue 
        ? $"https://cdn.cloudflare.steamstatic.com/steam/apps/{SteamId.Value}/header.jpg" 
        : null;

    [ObservableProperty]
    private int _fileCount;

    [ObservableProperty]
    private long _totalSizeBytes;

    [ObservableProperty]
    private DateTime? _lastModified;

    [ObservableProperty]
    private DateTime? _remoteModified;

    [ObservableProperty]
    private SyncStatus _status = SyncStatus.Unknown;

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private string _statusMessage = string.Empty;

    public List<SaveFileDetail> Files { get; set; } = new();

    public string TotalSizeFormatted
    {
        get
        {
            if (TotalSizeBytes <= 0) return "0 B";
            string[] suffixes = { "B", "KB", "MB", "GB" };
            int order = 0;
            double len = TotalSizeBytes;
            while (len >= 1024 && order < suffixes.Length - 1)
            {
                order++;
                len /= 1024;
            }
            return $"{len:0.##} {suffixes[order]}";
        }
    }

    public string LastModifiedFormatted => LastModified.HasValue
        ? LastModified.Value.ToString("dd/MM/yyyy HH:mm:ss")
        : "Chưa rõ";

    public string StatusBadgeText => Status switch
    {
        SyncStatus.Synced => "Đã đồng bộ",
        SyncStatus.LocalNewer => "Bản mới hơn trên máy",
        SyncStatus.RemoteNewer => "Bản mới hơn trên Cloud",
        SyncStatus.LocalOnly => "Chỉ có trên máy",
        SyncStatus.RemoteOnly => "Chỉ có trên Cloud",
        SyncStatus.Conflict => "Xung đột",
        SyncStatus.Syncing => "Đang đồng bộ...",
        _ => "Chưa kiểm tra"
    };

    public string StatusBadgeColor => Status switch
    {
        SyncStatus.Synced => "#10B981",       // Green
        SyncStatus.LocalNewer => "#3B82F6",    // Blue
        SyncStatus.RemoteNewer => "#F59E0B",   // Orange
        SyncStatus.LocalOnly => "#6B7280",     // Gray
        SyncStatus.RemoteOnly => "#8B5CF6",    // Purple
        SyncStatus.Conflict => "#EF4444",      // Red
        SyncStatus.Syncing => "#06B6D4",       // Cyan
        _ => "#9CA3AF"
    };

    partial void OnStatusChanged(SyncStatus value)
    {
        OnPropertyChanged(nameof(StatusBadgeText));
        OnPropertyChanged(nameof(StatusBadgeColor));
    }

    partial void OnTotalSizeBytesChanged(long value)
    {
        OnPropertyChanged(nameof(TotalSizeFormatted));
    }

    partial void OnLastModifiedChanged(DateTime? value)
    {
        OnPropertyChanged(nameof(LastModifiedFormatted));
    }
}

public class SaveFileDetail
{
    public string AbsolutePath { get; set; } = string.Empty;
    public string PlaceholderPath { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime LastWriteTime { get; set; }
    public string? Sha256 { get; set; }
}
