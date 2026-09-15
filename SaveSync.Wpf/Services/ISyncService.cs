using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public interface ISyncService
{
    Task CheckSyncStatusAsync(DetectedGame game);
    Task CheckAllSyncStatusesAsync(IEnumerable<DetectedGame> games);
    Task<(bool success, string? message)> SyncGameToCloudAsync(DetectedGame game);
    Task<(bool success, string? message)> RestoreGameFromCloudAsync(DetectedGame game);
}
