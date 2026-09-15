using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SaveSync.Desktop.Services;

public class GitHubService : IGitHubService
{
    private readonly IConfigService _configService;
    private readonly HttpClient _httpClient;

    public bool IsConfigured => _configService.Settings.IsGitHubConfigured;

    public GitHubService(IConfigService configService)
    {
        _configService = configService;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://api.github.com/")
        };
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "SaveSync-Desktop");
        _httpClient.DefaultRequestHeaders.Add("Accept", "application/vnd.github+json");
    }

    private void ApplyAuth()
    {
        var token = _configService.Settings.GitHubToken;
        if (!string.IsNullOrEmpty(token))
        {
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        else
        {
            _httpClient.DefaultRequestHeaders.Authorization = null;
        }
    }

    public async Task<(bool success, string? message)> TestConnectionAsync()
    {
        if (!IsConfigured)
        {
            return (false, "GitHub token, owner hoặc repo chưa được cấu hình.");
        }

        try
        {
            ApplyAuth();
            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;

            var res = await _httpClient.GetAsync($"repos/{owner}/{repo}");
            if (res.IsSuccessStatusCode)
            {
                var content = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(content);
                var isPrivate = doc.RootElement.TryGetProperty("private", out var priv) && priv.GetBoolean();
                var fullName = doc.RootElement.GetProperty("full_name").GetString();
                return (true, $"Kết nối thành công tới {fullName} ({(isPrivate ? "Private" : "Public")})");
            }
            else if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                return (false, "Xác thực thất bại: Personal Access Token không hợp lệ hoặc đã hết hạn (401).");
            }
            else if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return (false, $"Không tìm thấy repository '{owner}/{repo}' (404).");
            }
            else
            {
                var err = await res.Content.ReadAsStringAsync();
                return (false, $"GitHub API trả về lỗi: {res.StatusCode} - {err}");
            }
        }
        catch (Exception ex)
        {
            return (false, $"Lỗi kết nối mạng: {ex.Message}");
        }
    }

    public async Task<List<string>> ListRemoteGameIdsAsync()
    {
        var results = new List<string>();
        if (!IsConfigured) return results;

        try
        {
            ApplyAuth();
            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;

            var res = await _httpClient.GetAsync($"repos/{owner}/{repo}/contents/saves");
            if (res.IsSuccessStatusCode)
            {
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in doc.RootElement.EnumerateArray())
                    {
                        if (item.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "dir")
                        {
                            var name = item.GetProperty("name").GetString();
                            if (!string.IsNullOrEmpty(name)) results.Add(name);
                        }
                    }
                }
            }
        }
        catch { }

        return results;
    }

    public async Task<RemoteGameMeta?> GetRemoteMetaAsync(string gameId)
    {
        if (!IsConfigured) return null;

        try
        {
            ApplyAuth();
            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;

            var res = await _httpClient.GetAsync($"repos/{owner}/{repo}/contents/saves/{gameId}/meta.json");
            if (!res.IsSuccessStatusCode) return null;

            var json = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("content", out var contentProp))
            {
                var base64 = contentProp.GetString()?.Replace("\n", "").Replace("\r", "");
                if (!string.IsNullOrEmpty(base64))
                {
                    var bytes = Convert.FromBase64String(base64);
                    var rawMeta = Encoding.UTF8.GetString(bytes);
                    using var metaDoc = JsonDocument.Parse(rawMeta);

                    var root = metaDoc.RootElement;

                    string archiveHash = "";
                    if (root.TryGetProperty("archiveHash", out var ah)) archiveHash = ah.GetString() ?? "";
                    else if (root.TryGetProperty("sha256", out var s256)) archiveHash = s256.GetString() ?? "";

                    long totalSize = 0;
                    if (root.TryGetProperty("totalSize", out var ts) && ts.TryGetInt64(out var tsVal)) totalSize = tsVal;
                    else if (root.TryGetProperty("zipSize", out var zs) && zs.TryGetInt64(out var zsVal)) totalSize = zsVal;
                    else if (root.TryGetProperty("size", out var sz) && sz.TryGetInt64(out var szVal)) totalSize = szVal;

                    var meta = new RemoteGameMeta
                    {
                        GameId = gameId,
                        GameName = root.TryGetProperty("gameName", out var gn) ? gn.GetString() ?? gameId : gameId,
                        ArchiveHash = archiveHash,
                        FileCount = root.TryGetProperty("fileCount", out var fc) && fc.TryGetInt32(out var fcVal) ? fcVal : 0,
                        TotalSize = totalSize
                    };

                    DateTime dt = DateTime.MinValue;
                    if (root.TryGetProperty("updatedAt", out var upProp) && DateTime.TryParse(upProp.GetString(), out var udt))
                    {
                        dt = udt.ToLocalTime();
                    }
                    else if (root.TryGetProperty("timestamp", out var timeProp) && DateTime.TryParse(timeProp.GetString(), out var tdt))
                    {
                        dt = tdt.ToLocalTime();
                    }
                    else if (root.TryGetProperty("lastModified", out var lmProp) && DateTime.TryParse(lmProp.GetString(), out var ldt))
                    {
                        dt = ldt.ToLocalTime();
                    }

                    meta.Timestamp = dt;
                    return meta;
                }
            }
        }
        catch { }

        return null;
    }

    private async Task<string?> GetFileShaAsync(string path)
    {
        try
        {
            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;
            var res = await _httpClient.GetAsync($"repos/{owner}/{repo}/contents/{path}");
            if (res.IsSuccessStatusCode)
            {
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("sha", out var shaProp))
                {
                    return shaProp.GetString();
                }
            }
        }
        catch { }

        return null;
    }

    private async Task<(bool success, string? error)> UploadOrUpdateFileAsync(string repoPath, byte[] content, string commitMessage)
    {
        try
        {
            ApplyAuth();
            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;

            var existingSha = await GetFileShaAsync(repoPath);
            var base64 = Convert.ToBase64String(content);

            var payload = new Dictionary<string, object>
            {
                { "message", commitMessage },
                { "content", base64 }
            };

            if (!string.IsNullOrEmpty(existingSha))
            {
                payload["sha"] = existingSha;
            }

            var json = JsonSerializer.Serialize(payload);
            using var request = new HttpRequestMessage(HttpMethod.Put, $"repos/{owner}/{repo}/contents/{repoPath}")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };

            var res = await _httpClient.SendAsync(request);
            if (res.IsSuccessStatusCode)
            {
                return (true, null);
            }

            var err = await res.Content.ReadAsStringAsync();
            return (false, $"Lỗi upload {repoPath}: {res.StatusCode} - {err}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<(bool success, string? error)> UploadGameSaveAsync(string gameId, string zipPath, string metaPath, string mappingPath)
    {
        if (!IsConfigured)
            return (false, "GitHub chưa được cấu hình");

        if (!File.Exists(zipPath))
            return (false, $"File {zipPath} không tồn tại.");

        try
        {
            // Upload mapping.yaml if exists
            if (File.Exists(mappingPath))
            {
                var mappingBytes = await File.ReadAllBytesAsync(mappingPath);
                var rMap = await UploadOrUpdateFileAsync($"saves/{gameId}/mapping.yaml", mappingBytes, $"Sync mapping for {gameId}");
                if (!rMap.success) return rMap;
            }

            // Upload latest.zip
            var zipBytes = await File.ReadAllBytesAsync(zipPath);
            var rZip = await UploadOrUpdateFileAsync($"saves/{gameId}/latest.zip", zipBytes, $"Sync save archive for {gameId}");
            if (!rZip.success) return rZip;

            // Upload meta.json
            if (File.Exists(metaPath))
            {
                var metaBytes = await File.ReadAllBytesAsync(metaPath);
                var rMeta = await UploadOrUpdateFileAsync($"saves/{gameId}/meta.json", metaBytes, $"Sync meta for {gameId}");
                if (!rMeta.success) return rMeta;
            }

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<(bool success, string? error)> DownloadGameSaveAsync(string gameId, string targetDir)
    {
        if (!IsConfigured)
            return (false, "GitHub chưa được cấu hình");

        try
        {
            ApplyAuth();
            Directory.CreateDirectory(targetDir);

            var owner = _configService.Settings.GitHubOwner;
            var repo = _configService.Settings.GitHubRepo;

            // Download files: meta.json, mapping.yaml, latest.zip
            var filesToDownload = new[] { "latest.zip", "meta.json", "mapping.yaml" };
            foreach (var filename in filesToDownload)
            {
                var remotePath = $"saves/{gameId}/{filename}";
                var res = await _httpClient.GetAsync($"repos/{owner}/{repo}/contents/{remotePath}");
                if (!res.IsSuccessStatusCode)
                {
                    if (filename == "mapping.yaml") continue; // optional
                    return (false, $"Không tải được {remotePath}: {res.StatusCode}");
                }

                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var localDest = Path.Combine(targetDir, filename);

                if (root.TryGetProperty("download_url", out var dlUrlProp) && !string.IsNullOrEmpty(dlUrlProp.GetString()))
                {
                    var dlUrl = dlUrlProp.GetString()!;
                    using var dlRes = await _httpClient.GetAsync(dlUrl);
                    if (dlRes.IsSuccessStatusCode)
                    {
                        await using var fs = File.Create(localDest);
                        await dlRes.Content.CopyToAsync(fs);
                        continue;
                    }
                }

                if (root.TryGetProperty("content", out var cProp))
                {
                    var b64 = cProp.GetString()?.Replace("\n", "").Replace("\r", "");
                    if (!string.IsNullOrEmpty(b64))
                    {
                        var bytes = Convert.FromBase64String(b64);
                        await File.WriteAllBytesAsync(localDest, bytes);
                    }
                }
            }

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public async Task<(int remaining, int limit, int resetMinutes)> GetRateLimitAsync()
    {
        try
        {
            ApplyAuth();
            var res = await _httpClient.GetAsync("rate_limit");
            if (res.IsSuccessStatusCode)
            {
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("rate", out var rateProp))
                {
                    var rem = rateProp.GetProperty("remaining").GetInt32();
                    var lim = rateProp.GetProperty("limit").GetInt32();
                    var resetEpoch = rateProp.GetProperty("reset").GetInt64();
                    var resetTime = DateTimeOffset.FromUnixTimeSeconds(resetEpoch);
                    var minutes = Math.Max(0, (int)(resetTime - DateTimeOffset.UtcNow).TotalMinutes);
                    return (rem, lim, minutes);
                }
            }
        }
        catch { }

        return (0, 0, 0);
    }
}
