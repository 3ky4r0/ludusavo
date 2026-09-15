using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public interface IGameWatcherService
{
    bool IsRunning { get; }
    void Start(IEnumerable<DetectedGame> gamesToWatch);
    void Stop();
    event Action<DetectedGame>? OnGameExitedAndSynced;
}
