using System.Collections.ObjectModel;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SaveSync.Desktop.Models;
using SaveSync.Desktop.Services;

namespace SaveSync.Desktop.ViewModels;

public partial class CloudViewModel : ObservableObject
{
    private readonly IGitHubService _gitHubService;
    private readonly IRestoreService _restoreService;
    private readonly IManifestService _manifestService;

    [ObservableProperty]
    private ObservableCollection<RemoteGameMeta> _remoteSaves = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _statusText = "Sẵn sàng";

    [ObservableProperty]
    private string _rateLimitInfo = string.Empty;

    public CloudViewModel(
        IGitHubService gitHubService,
        IRestoreService restoreService,
        IManifestService manifestService)
    {
        _gitHubService = gitHubService;
        _restoreService = restoreService;
        _manifestService = manifestService;
    }

    [RelayCommand]
    public async Task RefreshCloudSavesAsync()
    {
        if (!_gitHubService.IsConfigured)
        {
            StatusText = "Chưa cấu hình GitHub trong Cài đặt.";
            return;
        }

        IsLoading = true;
        StatusText = "Đang tải danh sách save từ GitHub...";

        try
        {
            var gameIds = await _gitHubService.ListRemoteGameIdsAsync();
            RemoteSaves.Clear();

            foreach (var id in gameIds)
            {
                var meta = await _gitHubService.GetRemoteMetaAsync(id);
                if (meta != null)
                {
                    var gameEntry = _manifestService.GetGameById(id);
                    if (gameEntry != null)
                    {
                        meta.SteamId = gameEntry.GetSteamAppId();
                    }
                    RemoteSaves.Add(meta);
                }
            }

            var rate = await _gitHubService.GetRateLimitAsync();
            RateLimitInfo = $"GitHub API: {rate.remaining}/{rate.limit} requests còn lại (reset sau {rate.resetMinutes}p)";

            StatusText = $"Tìm thấy {RemoteSaves.Count} bản sao lưu trên GitHub.";
        }
        catch (Exception ex)
        {
            StatusText = $"Lỗi: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    public async Task DownloadAndRestoreAsync(RemoteGameMeta? meta)
    {
        if (meta == null) return;

        IsLoading = true;
        StatusText = $"Đang tải {meta.GameName} từ GitHub...";

        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), $"savesync_dl_{meta.GameId}");
            var dl = await _gitHubService.DownloadGameSaveAsync(meta.GameId, tempDir);
            if (!dl.success)
            {
                StatusText = $"Tải thất bại: {dl.error}";
                return;
            }

            StatusText = $"Đang khôi phục save vào máy...";
            var zipPath = Path.Combine(tempDir, "latest.zip");
            var restore = await _restoreService.RestoreGameAsync(meta.GameId, zipPath);

            if (restore.Success)
            {
                StatusText = $"Đã khôi phục thành công {restore.RestoredFilesCount} files của {meta.GameName}!";
            }
            else
            {
                StatusText = $"Khôi phục thất bại: {restore.ErrorMessage}";
            }
        }
        catch (Exception ex)
        {
            StatusText = $"Lỗi: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }
}
