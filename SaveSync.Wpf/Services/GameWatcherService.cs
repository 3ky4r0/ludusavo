using System.Diagnostics;
using System.IO;
using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class GameWatcherService : IGameWatcherService, IDisposable
{
    private readonly ISyncService _syncService;
    private readonly IConfigService _configService;
    private readonly System.Timers.Timer _timer;
    private readonly HashSet<string> _runningProcesses = new(StringComparer.OrdinalIgnoreCase);
    private List<DetectedGame> _watchedGames = new();

    public bool IsRunning { get; private set; }
    public event Action<DetectedGame>? OnGameExitedAndSynced;

    public GameWatcherService(ISyncService syncService, IConfigService configService)
    {
        _syncService = syncService;
        _configService = configService;

        _timer = new System.Timers.Timer(5000); // Check every 5 seconds
        _timer.Elapsed += async (s, e) => await CheckProcessesAsync();
    }

    public void Start(IEnumerable<DetectedGame> gamesToWatch)
    {
        _watchedGames = gamesToWatch.ToList();
        _timer.Start();
        IsRunning = true;
    }

    public void Stop()
    {
        _timer.Stop();
        IsRunning = false;
        _runningProcesses.Clear();
    }

    private async Task CheckProcessesAsync()
    {
        if (!_configService.Settings.AutoSyncOnExit) return;

        try
        {
            var currentProcessNames = Process.GetProcesses()
                .Select(p =>
                {
                    try { return p.ProcessName; } catch { return ""; }
                })
                .Where(n => !string.IsNullOrEmpty(n))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            // Detect any games that were previously running and now closed
            foreach (var game in _watchedGames)
            {
                // Guess process name from game id, name, or save paths
                var possibleNames = GetPossibleProcessNames(game);
                var wasRunning = possibleNames.Any(p => _runningProcesses.Contains(p));
                var isNowRunning = possibleNames.Any(p => currentProcessNames.Contains(p));

                if (wasRunning && !isNowRunning)
                {
                    // Game just exited! Trigger sync
                    Console.WriteLine($"[GameWatcher] Game {game.Name} exited! Auto-syncing...");
                    var res = await _syncService.SyncGameToCloudAsync(game);
                    if (res.success)
                    {
                        OnGameExitedAndSynced?.Invoke(game);
                    }
                }
            }

            _runningProcesses.Clear();
            foreach (var p in currentProcessNames)
            {
                _runningProcesses.Add(p);
            }
        }
        catch { }
    }

    private IEnumerable<string> GetPossibleProcessNames(DetectedGame game)
    {
        var names = new List<string>
        {
            game.Id,
            game.Id.Replace("-", ""),
            game.Name.Replace(" ", "").Replace(":", "").Replace("'", "")
        };

        return names;
    }

    public void Dispose()
    {
        _timer?.Dispose();
    }
}
