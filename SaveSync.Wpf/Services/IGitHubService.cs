namespace SaveSync.Desktop.Services;

public class RemoteGameMeta
{
    public string GameId { get; set; } = string.Empty;
    public string GameName { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public int FileCount { get; set; }
    public long TotalSize { get; set; }
    public string ArchiveHash { get; set; } = string.Empty;
    public int? SteamId { get; set; }

    public string? SteamBannerUrl => SteamId.HasValue
        ? $"https://cdn.cloudflare.steamstatic.com/steam/apps/{SteamId.Value}/header.jpg"
        : null;

    public string FormattedSize
    {
        get
        {
            if (TotalSize <= 0) return string.Empty;
            if (TotalSize < 1024) return $"{TotalSize} B";
            if (TotalSize < 1024 * 1024) return $"{TotalSize / 1024.0:F1} KB";
            return $"{TotalSize / (1024.0 * 1024.0):F1} MB";
        }
    }

    public string FormattedTimestamp => Timestamp == DateTime.MinValue || Timestamp.Year <= 1
        ? "Chưa rõ thời gian"
        : $"Đồng bộ: {Timestamp:dd/MM/yyyy HH:mm}";
}

public interface IGitHubService
{
    bool IsConfigured { get; }
    Task<(bool success, string? message)> TestConnectionAsync();
    Task<List<string>> ListRemoteGameIdsAsync();
    Task<RemoteGameMeta?> GetRemoteMetaAsync(string gameId);
    Task<(bool success, string? error)> UploadGameSaveAsync(string gameId, string zipPath, string metaPath, string mappingPath);
    Task<(bool success, string? error)> DownloadGameSaveAsync(string gameId, string targetDir);
    Task<(int remaining, int limit, int resetMinutes)> GetRateLimitAsync();
}
