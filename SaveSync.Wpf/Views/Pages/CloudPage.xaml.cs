using System.Windows.Controls;
using SaveSync.Desktop.ViewModels;

namespace SaveSync.Desktop.Views.Pages;

public partial class CloudPage : Page
{
    public CloudViewModel ViewModel { get; }

    public CloudPage(CloudViewModel viewModel)
    {
        ViewModel = viewModel;
        DataContext = viewModel;
        InitializeComponent();

        Loaded += async (s, e) =>
        {
            if (ViewModel.RemoteSaves.Count == 0)
            {
                await ViewModel.RefreshCloudSavesCommand.ExecuteAsync(null);
            }
        };
    }
}
