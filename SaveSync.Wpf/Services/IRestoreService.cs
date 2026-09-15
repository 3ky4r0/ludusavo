using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class RestoreResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public int RestoredFilesCount { get; set; }
}

public interface IRestoreService
{
    Task<RestoreResult> RestoreGameAsync(string gameId, string? specificZipPath = null);
}
