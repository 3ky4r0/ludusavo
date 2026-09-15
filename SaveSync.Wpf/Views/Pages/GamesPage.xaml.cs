using System.Windows.Controls;
using SaveSync.Desktop.ViewModels;

namespace SaveSync.Desktop.Views.Pages;

public partial class GamesPage : Page
{
    public GamesViewModel ViewModel { get; }

    public GamesPage(GamesViewModel viewModel)
    {
        ViewModel = viewModel;
        DataContext = viewModel;
        InitializeComponent();

        Loaded += async (s, e) =>
        {
            await ViewModel.InitializeAsync();
        };
    }
}
