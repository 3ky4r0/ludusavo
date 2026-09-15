using System.IO;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using SaveSync.Desktop.Services;
using SaveSync.Desktop.ViewModels;
using SaveSync.Desktop.Views.Pages;

namespace SaveSync.Desktop;

public partial class App : System.Windows.Application
{
    private IServiceProvider? _serviceProvider;
    private System.Windows.Forms.NotifyIcon? _notifyIcon;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var services = new ServiceCollection();
        ConfigureServices(services);
        _serviceProvider = services.BuildServiceProvider();

        var mainWindow = _serviceProvider.GetRequiredService<MainWindow>();

        // Setup System Tray
        SetupTrayIcon(mainWindow);

        var startMinimized = e.Args.Contains("--minimized");
        if (!startMinimized)
        {
            mainWindow.Show();
        }
    }

    private void ConfigureServices(IServiceCollection services)
    {
        // Services
        services.AddSingleton<IConfigService, ConfigService>();
        services.AddSingleton<IManifestService, ManifestService>();
        services.AddSingleton<IScannerService, ScannerService>();
        services.AddSingleton<IBackupService, BackupService>();
        services.AddSingleton<IRestoreService, RestoreService>();
        services.AddSingleton<IGitHubService, GitHubService>();
        services.AddSingleton<ISyncService, SyncService>();
        services.AddSingleton<IGameWatcherService, GameWatcherService>();

        // ViewModels
        services.AddSingleton<MainViewModel>();
        services.AddSingleton<GamesViewModel>();
        services.AddSingleton<CloudViewModel>();
        services.AddSingleton<SettingsViewModel>();

        // Views & Pages
        services.AddSingleton<MainWindow>();
        services.AddTransient<GamesPage>();
        services.AddTransient<CloudPage>();
        services.AddTransient<SettingsPage>();
    }

    private void SetupTrayIcon(MainWindow mainWindow)
    {
        try
        {
            System.Drawing.Icon? trayIcon = null;
            var config = _serviceProvider?.GetService<IConfigService>();
            if (config != null)
            {
                var assetIcon = Path.Combine(config.RootDir, "assets", "icon-512.ico");
                if (File.Exists(assetIcon))
                {
                    try { trayIcon = new System.Drawing.Icon(assetIcon); } catch { }
                }
            }

            if (trayIcon == null)
            {
                var exePath = Environment.ProcessPath;
                if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
                {
                    try { trayIcon = System.Drawing.Icon.ExtractAssociatedIcon(exePath); } catch { }
                }
            }

            _notifyIcon = new System.Windows.Forms.NotifyIcon
            {
                Text = "SaveSync - Game Save Manager",
                Icon = trayIcon ?? System.Drawing.SystemIcons.Application,
                Visible = true
            };

            _notifyIcon.DoubleClick += (s, e) =>
            {
                mainWindow.Show();
                mainWindow.WindowState = WindowState.Normal;
                mainWindow.Activate();
            };

            var contextMenu = new System.Windows.Forms.ContextMenuStrip();
            contextMenu.Items.Add("Mở SaveSync", null, (s, e) =>
            {
                mainWindow.Show();
                mainWindow.WindowState = WindowState.Normal;
                mainWindow.Activate();
            });

            contextMenu.Items.Add("Đồng bộ tất cả", null, async (s, e) =>
            {
                var gamesVm = _serviceProvider?.GetService<GamesViewModel>();
                if (gamesVm != null)
                {
                    await gamesVm.SyncAllCommand.ExecuteAsync(null);
                }
            });

            contextMenu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            contextMenu.Items.Add("Thoát", null, (s, e) =>
            {
                _notifyIcon.Visible = false;
                _notifyIcon.Dispose();
                mainWindow.ForceClose();
                Shutdown();
            });

            _notifyIcon.ContextMenuStrip = contextMenu;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Tray] Could not initialize tray icon: {ex.Message}");
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_notifyIcon != null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
        }

        var watcher = _serviceProvider?.GetService<IGameWatcherService>();
        watcher?.Stop();

        base.OnExit(e);
    }
}
