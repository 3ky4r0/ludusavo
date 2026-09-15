using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SaveSync.Desktop.Services;

namespace SaveSync.Desktop.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly IConfigService _configService;
    private readonly IGitHubService _gitHubService;

    public GamesViewModel GamesVm { get; }

    [ObservableProperty]
    private string _title = "SaveSync - Native Game Save Manager";

    [ObservableProperty]
    private bool _isGitHubConnected;

    [ObservableProperty]
    private string _gitHubStatusText = "Chưa kết nối GitHub";

    [ObservableProperty]
    private int _detectedCount;

    [ObservableProperty]
    private bool _isGlobalBusy;

    [ObservableProperty]
    private string _globalBusyText = string.Empty;

    public MainViewModel(IConfigService configService, IGitHubService gitHubService, GamesViewModel gamesVm)
    {
        _configService = configService;
        _gitHubService = gitHubService;
        GamesVm = gamesVm;
        UpdateGitHubStatus();
    }

    public void UpdateGitHubStatus()
    {
        if (_gitHubService.IsConfigured)
        {
            IsGitHubConnected = true;
            GitHubStatusText = $"{_configService.Settings.GitHubOwner}/{_configService.Settings.GitHubRepo}";
        }
        else
        {
            IsGitHubConnected = false;
            GitHubStatusText = "GitHub: Chưa cấu hình Token";
        }
    }
}
