using System.ComponentModel;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using SaveSync.Desktop.Services;
using SaveSync.Desktop.ViewModels;
using SaveSync.Desktop.Views.Pages;

namespace SaveSync.Desktop;

public partial class MainWindow : Window
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IConfigService _configService;
    private readonly MainViewModel _viewModel;
    private bool _isExplicitExit = false;

    public MainWindow(
        MainViewModel viewModel,
        IServiceProvider serviceProvider,
        IConfigService configService)
    {
        _viewModel = viewModel;
        _serviceProvider = serviceProvider;
        _configService = configService;

        DataContext = viewModel;
        InitializeComponent();

        Loaded += MainWindow_Loaded;
    }

    private void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        GamesFrame.Navigate(_serviceProvider.GetRequiredService<GamesPage>());
        CloudFrame.Navigate(_serviceProvider.GetRequiredService<CloudPage>());
        SettingsFrame.Navigate(_serviceProvider.GetRequiredService<SettingsPage>());
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_isExplicitExit && _configService.Settings.MinimizeToTray)
        {
            e.Cancel = true;
            Hide();
        }
        else
        {
            base.OnClosing(e);
        }
    }

    public void ForceClose()
    {
        _isExplicitExit = true;
        Close();
    }
}
