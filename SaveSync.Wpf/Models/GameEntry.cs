using System.Text.Json.Serialization;

namespace SaveSync.Desktop.Models;

public class GameEntry
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("savePaths")]
    public List<SavePathEntry> SavePaths { get; set; } = new();

    [JsonPropertyName("steamId")]
    public object? SteamId { get; set; }

    public int? GetSteamAppId()
    {
        if (SteamId is int id) return id;
        if (SteamId is System.Text.Json.JsonElement elem && elem.ValueKind == System.Text.Json.JsonValueKind.Number && elem.TryGetInt32(out var val))
            return val;
        return null;
    }
}

public class SavePathEntry
{
    [JsonPropertyName("path")]
    public string Path { get; set; } = string.Empty;

    [JsonPropertyName("tags")]
    public List<string>? Tags { get; set; }

    [JsonPropertyName("when")]
    public List<WhenCondition>? When { get; set; }
}

public class WhenCondition
{
    [JsonPropertyName("os")]
    public string? Os { get; set; }

    [JsonPropertyName("store")]
    public string? Store { get; set; }
}
