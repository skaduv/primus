using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Windowing;
using Windows.Graphics;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace Primus;

/// <summary>
/// The application window. This hosts a Frame that displays pages. Add your
/// UI and logic to MainPage.xaml / MainPage.xaml.cs instead of here so you
/// can use Page features such as navigation events and the Loaded lifecycle.
/// </summary>
public sealed partial class MainWindow : Window
{
    private const double StartupWidthDip = 888;
    private bool _isDarkTheme;

    public MainWindow()
    {
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        AppWindow.SetIcon("Assets/AppIcon.ico");

        // Navigate the root frame to the main page on startup.
        RootFrame.Loaded += RootFrame_Loaded;
        RootFrame.Navigate(typeof(MainPage));
    }

    private void RootFrame_Loaded(object sender, RoutedEventArgs e)
    {
        RootFrame.Loaded -= RootFrame_Loaded;

        var displayArea = DisplayArea.GetFromWindowId(
            AppWindow.Id,
            DisplayAreaFallback.Nearest);
        if (displayArea is null || RootFrame.XamlRoot is null)
        {
            return;
        }

        var workArea = displayArea.WorkArea;
        var scale = RootFrame.XamlRoot.RasterizationScale;
        var width = (int)Math.Round(StartupWidthDip * scale);
        var height = AppWindow.Size.Height;
        var x = workArea.X + (workArea.Width - width) / 2;
        var y = workArea.Y + (workArea.Height - height) / 2;

        AppWindow.MoveAndResize(new RectInt32(x, y, width, height));
    }

    private void ThemeToggleButton_Click(object sender, RoutedEventArgs e)
    {
        _isDarkTheme = !_isDarkTheme;
        RootLayout.RequestedTheme = _isDarkTheme
            ? ElementTheme.Dark
            : ElementTheme.Light;

        MoonIcon.Visibility = _isDarkTheme ? Visibility.Collapsed : Visibility.Visible;
        SunIcon.Visibility = _isDarkTheme ? Visibility.Visible : Visibility.Collapsed;

        var actionLabel = _isDarkTheme ? "切换到浅色主题" : "切换到深色主题";
        ToolTipService.SetToolTip(ThemeToggleButton, actionLabel);
        AutomationProperties.SetName(ThemeToggleButton, actionLabel);
    }
}
