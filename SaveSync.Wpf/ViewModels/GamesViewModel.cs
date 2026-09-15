using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows.Data;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SaveSync.Desktop.Models;
using SaveSync.Desktop.Services;

namespace SaveSync.Desktop.ViewModels;

public partial class GamesViewModel : ObservableObject
{
    private readonly IManifestService _manifestService;
    private readonly IScannerService _scannerService;
    private readonly ISyncService _syncService;
    private readonly IGameWatcherService _gameWatcher;

    [ObservableProperty]
    private ObservableCollection<DetectedGame> _games = new();

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private bool _isScanning;

    [ObservableProperty]
    private string _scanStatusText = "Sẵn sàng";

    [ObservableProperty]
    private double _scanProgress;

    [ObservableProperty]
    private DetectedGame? _selectedGame;

    public GamesViewModel(
        IManifestService manifestService,
        IScannerService scannerService,
        ISyncService syncService,
        IGameWatcherService gameWatcher)
    {
        _manifestService = manifestService;
        _scannerService = scannerService;
        _syncService = syncService;
        _gameWatcher = gameWatcher;

        _gameWatcher.OnGameExitedAndSynced += game =>
        {
            App.Current?.Dispatcher?.Invoke(() =>
            {
                ScanStatusText = $"Tự động đồng bộ {game.Name} thành công!";
            });
        };
    }

    public async Task InitializeAsync()
    {
        if (Games.Count > 0) return;
        await LoadAndScanGamesAsync(forceRescan: false);
    }

    [RelayCommand]
    public async Task RefreshScanAsync()
    {
        await LoadAndScanGamesAsync(forceRescan: true);
    }

    private async Task LoadAndScanGamesAsync(bool forceRescan)
    {
        if (IsScanning) return;

        IsScanning = true;
        ScanProgress = 0;
        ScanStatusText = "Đang tải cơ sở dữ liệu game...";

        try
        {
            if (!_manifestService.IsLoaded)
            {
                var loaded = await _manifestService.LoadManifestAsync();
                if (!loaded)
                {
                    ScanStatusText = "Không tìm thấy dữ liệu manifest_processed.json!";
                    IsScanning = false;
                    return;
                }
            }

            ScanStatusText = $"Đang quét hệ thống ({_manifestService.GameCount:N0} games)...";

            var progress = new Progress<(int current, int total, string currentName)>(p =>
            {
                if (p.total > 0)
                {
                    ScanProgress = (double)p.current / p.total * 100;
                    ScanStatusText = $"Đang quét: {p.currentName} ({p.current}/{p.total})";
                }
            });

            var detected = await _scannerService.GetDetectedGamesAsync(
                _manifestService.GetAllGames(),
                forceRescan: forceRescan,
                progress: progress);

            Games.Clear();
            foreach (var g in detected.OrderBy(d => d.Name))
            {
                Games.Add(g);
            }

            ScanStatusText = $"Tìm thấy {Games.Count} game có file save trên máy.";

            // Start watcher for detected games
            _gameWatcher.Start(Games);

            // Check cloud sync statuses in background
            _ = Task.Run(async () =>
            {
                await _syncService.CheckAllSyncStatusesAsync(Games);
            });
        }
        catch (Exception ex)
        {
            ScanStatusText = $"Lỗi quét: {ex.Message}";
        }
        finally
        {
            IsScanning = false;
        }
    }

    [RelayCommand]
    public async Task SyncGameAsync(DetectedGame? game)
    {
        if (game == null) return;
        await _syncService.SyncGameToCloudAsync(game);
    }

    [RelayCommand]
    public async Task RestoreGameAsync(DetectedGame? game)
    {
        if (game == null) return;
        await _syncService.RestoreGameFromCloudAsync(game);
    }

    [RelayCommand]
    public async Task SyncAllAsync()
    {
        if (IsScanning || Games.Count == 0) return;

        IsScanning = true;
        ScanStatusText = "Đang đồng bộ tất cả game lên Cloud...";

        int success = 0;
        foreach (var game in Games)
        {
            ScanStatusText = $"Đang sao lưu & đồng bộ {game.Name}...";
            var res = await _syncService.SyncGameToCloudAsync(game);
            if (res.success) success++;
        }

        ScanStatusText = $"Đã đồng bộ xong {success}/{Games.Count} game.";
        IsScanning = false;
    }

    [RelayCommand]
    public void OpenSaveFolder(DetectedGame? game)
    {
        if (game == null || game.Files.Count == 0) return;
        var firstFile = game.Files.FirstOrDefault()?.AbsolutePath;
        if (!string.IsNullOrEmpty(firstFile))
        {
            var dir = Path.GetDirectoryName(firstFile);
            if (Directory.Exists(dir))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = dir,
                    UseShellExecute = true
                });
            }
        }
    }

    partial void OnSearchTextChanged(string value)
    {
        var view = CollectionViewSource.GetDefaultView(Games);
        if (view == null) return;

        if (string.IsNullOrWhiteSpace(value))
        {
            view.Filter = null;
        }
        else
        {
            var q = value.Trim();
            view.Filter = obj =>
            {
                if (obj is DetectedGame g)
                {
                    return g.Name.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                           g.Id.Contains(q, StringComparison.OrdinalIgnoreCase);
                }
                return false;
            };
        }
    }
}
