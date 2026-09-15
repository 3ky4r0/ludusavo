using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public interface IScannerService
{
    Task<DetectedGame?> ScanGameAsync(GameEntry game);
    Task<List<DetectedGame>> ScanGamesAsync(IEnumerable<GameEntry> games, IProgress<(int current, int total, string currentName)>? progress = null);
    Task<List<DetectedGame>> GetDetectedGamesAsync(IReadOnlyList<GameEntry> allGames, bool forceRescan = false, IProgress<(int current, int total, string currentName)>? progress = null);
    string ToPlaceholderPath(string fullPath);
}
