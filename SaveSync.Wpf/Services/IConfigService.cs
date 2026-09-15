using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public interface IConfigService
{
    AppSettings Settings { get; }
    string RootDir { get; }
    string DataDir { get; }
    string CacheDir { get; }
    string ManifestCachePath { get; }
    void SaveSettings(AppSettings newSettings);
    void ReloadSettings();
}
