using System.IO;
using System.Text.Json;
using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class ManifestService : IManifestService
{
    private readonly IConfigService _configService;
    private readonly Dictionary<string, GameEntry> _gamesById = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, GameEntry> _gamesBySteamId = new();
    private List<GameEntry> _gamesList = new();

    public bool IsLoaded { get; private set; }
    public int GameCount => _gamesList.Count;

    public ManifestService(IConfigService configService)
    {
        _configService = configService;
    }

    public async Task<bool> LoadManifestAsync()
    {
        var cachePath = _configService.ManifestCachePath;

        // Fallback: check if manifest_processed.json is in parent data/cache or relative
        if (!File.Exists(cachePath))
        {
            var fallback = Path.Combine(_configService.RootDir, "data", "cache", "manifest_processed.json");
            if (File.Exists(fallback))
            {
                cachePath = fallback;
            }
        }

        if (!File.Exists(cachePath))
        {
            Console.WriteLine($"[ManifestService] Manifest cache not found at {cachePath}");
            return false;
        }

        try
        {
            await using var stream = File.OpenRead(cachePath);
            var loaded = await JsonSerializer.DeserializeAsync<List<GameEntry>>(stream);

            if (loaded != null && loaded.Count > 0)
            {
                _gamesList = loaded;
                _gamesById.Clear();
                _gamesBySteamId.Clear();

                foreach (var g in _gamesList)
                {
                    _gamesById[g.Id] = g;
                    var sid = g.GetSteamAppId();
                    if (sid.HasValue)
                    {
                        _gamesBySteamId[sid.Value] = g;
                    }
                }

                IsLoaded = true;
                return true;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ManifestService] Error loading manifest: {ex.Message}");
        }

        return false;
    }

    public IReadOnlyList<GameEntry> GetAllGames() => _gamesList;

    public GameEntry? GetGameById(string id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        _gamesById.TryGetValue(id, out var game);
        return game;
    }

    public GameEntry? GetGameBySteamId(int steamId)
    {
        _gamesBySteamId.TryGetValue(steamId, out var game);
        return game;
    }

    public IEnumerable<GameEntry> SearchGames(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return _gamesList;

        var q = query.Trim();
        return _gamesList.Where(g =>
            g.Name.Contains(q, StringComparison.OrdinalIgnoreCase) ||
            g.Id.Contains(q, StringComparison.OrdinalIgnoreCase));
    }
}
