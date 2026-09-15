using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class BackupResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public string ZipPath { get; set; } = string.Empty;
    public string MetaPath { get; set; } = string.Empty;
    public string MappingPath { get; set; } = string.Empty;
    public string ArchiveHash { get; set; } = string.Empty;
    public long ArchiveSizeBytes { get; set; }
    public DateTime Timestamp { get; set; }
}

public interface IBackupService
{
    Task<BackupResult> CreateBackupAsync(DetectedGame game);
    string GetGameCacheDir(string gameId);
}
