using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace Primus;

/// <summary>
/// The main content page displayed inside the application window.
/// Add your UI logic, event handlers, and data binding here.
/// </summary>
public sealed partial class MainPage : Page
{
    private Storyboard? _introStoryboard;

    public MainPage()
    {
        InitializeComponent();
    }

    private async void MainPage_Loaded(object sender, RoutedEventArgs e)
    {
        Loaded -= MainPage_Loaded;
        await Task.Delay(TimeSpan.FromSeconds(1));

        var splashFade = new DoubleAnimation
        {
            To = 0,
            Duration = TimeSpan.FromMilliseconds(520),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut },
        };
        Storyboard.SetTarget(splashFade, SplashOverlay);
        Storyboard.SetTargetProperty(splashFade, "Opacity");

        var mainFade = new DoubleAnimation
        {
            To = 1,
            BeginTime = TimeSpan.FromMilliseconds(180),
            Duration = TimeSpan.FromMilliseconds(560),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(mainFade, MainExperience);
        Storyboard.SetTargetProperty(mainFade, "Opacity");

        _introStoryboard = new Storyboard();
        _introStoryboard.Children.Add(splashFade);
        _introStoryboard.Children.Add(mainFade);
        _introStoryboard.Completed += (_, _) =>
        {
            SplashOverlay.Visibility = Visibility.Collapsed;
            MainExperience.IsHitTestVisible = true;
            PromptBox.Focus(FocusState.Programmatic);
        };
        _introStoryboard.Begin();
    }
}
