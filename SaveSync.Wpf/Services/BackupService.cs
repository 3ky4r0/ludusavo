using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using SaveSync.Desktop.Models;
using YamlDotNet.Serialization;

namespace SaveSync.Desktop.Services;

public class BackupService : IBackupService
{
    private readonly IConfigService _configService;

    public BackupService(IConfigService configService)
    {
        _configService = configService;
    }

    public string GetGameCacheDir(string gameId)
    {
        var dir = Path.Combine(_configService.CacheDir, gameId);
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static string ComputeSha256(string filePath)
    {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(filePath);
        var hash = sha.ComputeHash(stream);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    public static string ComputeSha256(byte[] data)
    {
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(data);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    public async Task<BackupResult> CreateBackupAsync(DetectedGame game)
    {
        if (game == null || game.Files.Count == 0)
        {
            return new BackupResult { Success = false, ErrorMessage = "Không tìm thấy file save nào của game." };
        }

        try
        {
            var gameCacheDir = GetGameCacheDir(game.Id);
            var timestamp = DateTime.UtcNow;

            // Generate mapping for Ludusavi
            var drives = new Dictionary<string, string>();
            var fileList = new List<object>();

            var zipPath = Path.Combine(gameCacheDir, "latest.zip");
            var metaPath = Path.Combine(gameCacheDir, "meta.json");
            var mappingPath = Path.Combine(gameCacheDir, "mapping.yaml");

            // Temporary file to write zip atomically
            var tempZip = Path.Combine(Path.GetTempPath(), $"savesync_{game.Id}_{Guid.NewGuid():N}.zip");

            await Task.Run(() =>
            {
                using (var zipStream = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Create))
                {
                    foreach (var file in game.Files)
                    {
                        if (!File.Exists(file.AbsolutePath)) continue;

                        var fullPath = Path.GetFullPath(file.AbsolutePath);
                        var root = Path.GetPathRoot(fullPath) ?? "C:\\";
                        var letter = root.TrimEnd(':', '\\', '/').ToUpper();
                        if (string.IsNullOrEmpty(letter)) letter = "C";

                        var driveKey = $"drive-{letter}";
                        drives[driveKey] = $"{letter}:";

                        var relPath = fullPath.Substring(root.Length).TrimStart('\\', '/').Replace('\\', '/');
                        var archiveEntryName = $"{driveKey}/{relPath}";

                        // Compute file hash
                        var hash = ComputeSha256(fullPath);
                        file.Sha256 = hash;

                        fileList.Add(new
                        {
                            path = file.PlaceholderPath,
                            archivePath = archiveEntryName,
                            size = file.Size,
                            hash = hash,
                            modified = file.LastWriteTime.ToString("o")
                        });

                        // Add to archive
                        archive.CreateEntryFromFile(fullPath, archiveEntryName, CompressionLevel.Optimal);
                    }
                }

                // Replace latest.zip
                if (File.Exists(zipPath)) File.Delete(zipPath);
                File.Move(tempZip, zipPath);

                // Write mapping.yaml
                var serializer = new SerializerBuilder().Build();
                var mappingObj = new Dictionary<string, object>
                {
                    { "drives", drives }
                };
                var yamlContent = serializer.Serialize(mappingObj);
                File.WriteAllText(mappingPath, yamlContent);

                // Compute overall archive hash
                var archiveHash = ComputeSha256(zipPath);
                var archiveSize = new FileInfo(zipPath).Length;

                // Write meta.json
                var metaObj = new
                {
                    gameId = game.Id,
                    gameName = game.Name,
                    timestamp = timestamp.ToString("o"),
                    updatedAt = timestamp.ToString("o"),
                    lastModified = timestamp.ToString("o"),
                    fileCount = fileList.Count,
                    totalSize = archiveSize,
                    zipSize = archiveSize,
                    size = archiveSize,
                    archiveHash = archiveHash,
                    sha256 = archiveHash,
                    files = fileList
                };

                var metaJson = JsonSerializer.Serialize(metaObj, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(metaPath, metaJson);
            });

            return new BackupResult
            {
                Success = true,
                ZipPath = zipPath,
                MetaPath = metaPath,
                MappingPath = mappingPath,
                ArchiveHash = ComputeSha256(zipPath),
                ArchiveSizeBytes = new FileInfo(zipPath).Length,
                Timestamp = timestamp
            };
        }
        catch (Exception ex)
        {
            return new BackupResult
            {
                Success = false,
                ErrorMessage = ex.Message
            };
        }
    }
}
