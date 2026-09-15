using System.Windows.Controls;
using SaveSync.Desktop.ViewModels;

namespace SaveSync.Desktop.Views.Pages;

public partial class SettingsPage : Page
{
    public SettingsViewModel ViewModel { get; }

    public SettingsPage(SettingsViewModel viewModel)
    {
        ViewModel = viewModel;
        DataContext = viewModel;
        InitializeComponent();

        // PasswordBox doesn't support direct binding, so sync manually
        TokenBox.Password = viewModel.GitHubToken;
    }

    private void TokenBox_PasswordChanged(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is SettingsViewModel vm)
        {
            vm.GitHubToken = TokenBox.Password;
        }
    }
}
