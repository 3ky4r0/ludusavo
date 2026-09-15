using System.IO;
using System.IO.Compression;
using YamlDotNet.Serialization;

namespace SaveSync.Desktop.Services;

public class RestoreService : IRestoreService
{
    private readonly IConfigService _configService;

    public RestoreService(IConfigService configService)
    {
        _configService = configService;
    }

    public async Task<RestoreResult> RestoreGameAsync(string gameId, string? specificZipPath = null)
    {
        var gameCacheDir = Path.Combine(_configService.CacheDir, gameId);
        var zipPath = specificZipPath ?? Path.Combine(gameCacheDir, "latest.zip");
        var mappingPath = Path.Combine(gameCacheDir, "mapping.yaml");

        if (!File.Exists(zipPath))
        {
            return new RestoreResult { Success = false, ErrorMessage = $"Không tìm thấy file backup archive tại {zipPath}" };
        }

        try
        {
            return await Task.Run(() =>
            {
                // Read drives mapping
                var driveMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (File.Exists(mappingPath))
                {
                    try
                    {
                        var yaml = File.ReadAllText(mappingPath);
                        var deserializer = new DeserializerBuilder().Build();
                        var root = deserializer.Deserialize<Dictionary<string, object>>(yaml);
                        if (root != null && root.TryGetValue("drives", out var drivesObj) && drivesObj is Dictionary<object, object> dDict)
                        {
                            foreach (var kv in dDict)
                            {
                                driveMap[kv.Key.ToString()!] = kv.Value.ToString()!;
                            }
                        }
                    }
                    catch { }
                }

                int count = 0;
                using var zip = ZipFile.OpenRead(zipPath);

                // Also check if mapping.yaml is embedded in the zip itself
                var embeddedMapping = zip.GetEntry("mapping.yaml");
                if (embeddedMapping != null && driveMap.Count == 0)
                {
                    try
                    {
                        using var s = embeddedMapping.Open();
                        using var reader = new StreamReader(s);
                        var yaml = reader.ReadToEnd();
                        var deserializer = new DeserializerBuilder().Build();
                        var root = deserializer.Deserialize<Dictionary<string, object>>(yaml);
                        if (root != null && root.TryGetValue("drives", out var drivesObj) && drivesObj is Dictionary<object, object> dDict)
                        {
                            foreach (var kv in dDict)
                            {
                                driveMap[kv.Key.ToString()!] = kv.Value.ToString()!;
                            }
                        }
                    }
                    catch { }
                }

                foreach (var entry in zip.Entries)
                {
                    if (string.IsNullOrEmpty(entry.Name)) continue; // Directory entry
                    if (entry.FullName.Equals("mapping.yaml", StringComparison.OrdinalIgnoreCase)) continue;

                    // Form: drive-C/path/to/file.ext
                    var parts = entry.FullName.Split('/', 2);
                    if (parts.Length < 2) continue;

                    var driveKey = parts[0];
                    var relativePath = parts[1].Replace('/', Path.DirectorySeparatorChar);

                    string targetDrive;
                    if (driveMap.TryGetValue(driveKey, out var mappedDrive))
                    {
                        targetDrive = mappedDrive.TrimEnd('\\', '/');
                    }
                    else if (driveKey.StartsWith("drive-", StringComparison.OrdinalIgnoreCase))
                    {
                        var letter = driveKey.Substring("drive-".Length);
                        targetDrive = $"{letter}:";
                    }
                    else
                    {
                        targetDrive = "C:";
                    }

                    var destPath = Path.Combine(targetDrive + Path.DirectorySeparatorChar, relativePath);
                    var destDir = Path.GetDirectoryName(destPath);
                    if (!string.IsNullOrEmpty(destDir))
                    {
                        Directory.CreateDirectory(destDir);
                    }

                    entry.ExtractToFile(destPath, overwrite: true);
                    count++;
                }

                return new RestoreResult { Success = true, RestoredFilesCount = count };
            });
        }
        catch (Exception ex)
        {
            return new RestoreResult { Success = false, ErrorMessage = ex.Message };
        }
    }
}
