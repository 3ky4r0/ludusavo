using System.IO;
using System.Text.Json;
using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class ConfigService : IConfigService
{
    private readonly string _settingsFilePath;
    private AppSettings _settings = new();

    public AppSettings Settings => _settings;
    public string RootDir { get; private set; }
    public string DataDir { get; private set; }
    public string CacheDir { get; private set; }
    public string ManifestCachePath { get; private set; }

    public ConfigService()
    {
        // Determine root directory (either repo/solution root or executable dir)
        var exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string? candidate = exeDir;
        string? resolvedRoot = null;

        while (!string.IsNullOrEmpty(candidate))
        {
            if (File.Exists(Path.Combine(candidate, "SaveSync.sln")) ||
                File.Exists(Path.Combine(candidate, "SaveSync.slnx")) ||
                Directory.Exists(Path.Combine(candidate, "data", "cache")))
            {
                resolvedRoot = candidate;
                break;
            }
            var p = Directory.GetParent(candidate);
            candidate = p?.FullName;
        }

        if (resolvedRoot == null)
        {
            candidate = Directory.GetCurrentDirectory();
            while (!string.IsNullOrEmpty(candidate))
            {
                if (File.Exists(Path.Combine(candidate, "SaveSync.sln")) ||
                    File.Exists(Path.Combine(candidate, "SaveSync.slnx")) ||
                    Directory.Exists(Path.Combine(candidate, "data", "cache")))
                {
                    resolvedRoot = candidate;
                    break;
                }
                var p = Directory.GetParent(candidate);
                candidate = p?.FullName;
            }
        }

        RootDir = resolvedRoot ?? exeDir;

        DataDir = Path.Combine(RootDir, "data");
        CacheDir = Path.Combine(DataDir, "cache");
        ManifestCachePath = Path.Combine(CacheDir, "manifest_processed.json");

        // Ensure directories exist
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(CacheDir);

        _settingsFilePath = Path.Combine(RootDir, "appsettings.json");

        LoadSettings();
    }

    private void LoadSettings()
    {
        _settings = new AppSettings();

        // 1. Try to load from appsettings.json if it exists
        if (File.Exists(_settingsFilePath))
        {
            try
            {
                var json = File.ReadAllText(_settingsFilePath);
                var loaded = JsonSerializer.Deserialize<AppSettings>(json);
                if (loaded != null)
                {
                    _settings = loaded;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ConfigService] Error reading settings: {ex.Message}");
            }
        }

        // 2. Read fallback values from .env if properties are empty
        var envPath = Path.Combine(RootDir, ".env");
        if (File.Exists(envPath))
        {
            try
            {
                var lines = File.ReadAllLines(envPath);
                foreach (var line in lines)
                {
                    var trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#')) continue;

                    var parts = trimmed.Split('=', 2);
                    if (parts.Length != 2) continue;

                    var key = parts[0].Trim();
                    var val = parts[1].Trim().Trim('"', '\'');

                    if (key == "GITHUB_TOKEN" && string.IsNullOrEmpty(_settings.GitHubToken))
                        _settings.GitHubToken = val;
                    else if (key == "GITHUB_OWNER" && string.IsNullOrEmpty(_settings.GitHubOwner))
                        _settings.GitHubOwner = val;
                    else if (key == "GITHUB_REPO" && string.IsNullOrEmpty(_settings.GitHubRepo))
                        _settings.GitHubRepo = val;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ConfigService] Error reading .env: {ex.Message}");
            }
        }
    }

    public void SaveSettings(AppSettings newSettings)
    {
        _settings = newSettings;
        try
        {
            var options = new JsonSerializerOptions { WriteIndented = true };
            var json = JsonSerializer.Serialize(_settings, options);
            File.WriteAllText(_settingsFilePath, json);

            // Also keep .env in sync for interoperability
            var envPath = Path.Combine(RootDir, ".env");
            var envContent = $"GITHUB_TOKEN={_settings.GitHubToken}\nGITHUB_OWNER={_settings.GitHubOwner}\nGITHUB_REPO={_settings.GitHubRepo}\n";
            File.WriteAllText(envPath, envContent);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ConfigService] Error saving settings: {ex.Message}");
        }
    }

    public void ReloadSettings()
    {
        LoadSettings();
    }
}
