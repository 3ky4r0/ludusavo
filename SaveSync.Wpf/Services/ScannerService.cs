using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using SaveSync.Desktop.Models;

namespace SaveSync.Desktop.Services;

public class ScannerService : IScannerService
{
    private readonly IConfigService _configService;
    private readonly Dictionary<string, string> _placeholders;
    private readonly List<string> _knownRoots = new();
    private readonly List<string> _steamRoots = new();

    private static readonly HashSet<string> IgnoredFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "graphicsconfig.xml",
        "remotecache.vdf",
        "desktop.ini",
        "thumbs.db"
    };

    public ScannerService(IConfigService configService)
    {
        _configService = configService;
        _placeholders = InitializePlaceholders();
        InitializeKnownRoots();
    }

    private Dictionary<string, string> InitializePlaceholders()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var localAppDataLow = Path.Combine(home, "AppData", "LocalLow");
        
        // Use real Documents folder, not OneDrive redirection if possible
        var winDocuments = Path.Combine(home, "Documents");
        if (!Directory.Exists(winDocuments))
        {
            winDocuments = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        }

        var winSavedGames = Path.Combine(home, "Saved Games");
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var driveRoot = Path.GetPathRoot(home) ?? "C:\\";
        var winPublic = Path.Combine(driveRoot, "Users", "Public");
        var userName = Environment.UserName;

        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "<home>", home },
            { "<winDocuments>", winDocuments },
            { "<documents>", winDocuments },
            { "<winSavedGames>", winSavedGames },
            { "<savedGames>", winSavedGames },
            { "<appdata>", appData },
            { "<winAppData>", appData },
            { "<localappdata>", localAppData },
            { "<winLocalAppData>", localAppData },
            { "<localappdataLow>", localAppDataLow },
            { "<winLocalAppDataLow>", localAppDataLow },
            { "<winProgramData>", programData },
            { "<winDir>", winDir },
            { "<winPublic>", winPublic },
            { "<osUserName>", userName },
            { "<xdgConfig>", appData },
            { "<xdgData>", localAppData }
        };
    }

    private void InitializeKnownRoots()
    {
        _knownRoots.Clear();
        _steamRoots.Clear();

        // 1. Steam paths from registry or common locations
        var commonSteam = new[]
        {
            @"C:\Program Files (x86)\Steam",
            @"C:\Program Files\Steam",
            @"D:\Steam",
            @"E:\Steam",
            @"F:\Steam"
        };

        foreach (var p in commonSteam)
        {
            if (Directory.Exists(p) && !_steamRoots.Contains(p, StringComparer.OrdinalIgnoreCase))
            {
                _steamRoots.Add(p);
                _knownRoots.Add(p);
            }
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            var steamPath = key?.GetValue("SteamPath") as string;
            if (!string.IsNullOrEmpty(steamPath))
            {
                steamPath = steamPath.Replace('/', '\\');
                if (Directory.Exists(steamPath) && !_steamRoots.Contains(steamPath, StringComparer.OrdinalIgnoreCase))
                {
                    _steamRoots.Add(steamPath);
                    _knownRoots.Add(steamPath);
                }
            }
        }
        catch { }

        // Find additional steam libraries from libraryfolders.vdf
        foreach (var root in _steamRoots.ToList())
        {
            var vdf = Path.Combine(root, "steamapps", "libraryfolders.vdf");
            if (File.Exists(vdf))
            {
                try
                {
                    var lines = File.ReadAllLines(vdf);
                    foreach (var line in lines)
                    {
                        var match = Regex.Match(line, @"""path""\s+""([^""]+)""");
                        if (match.Success)
                        {
                            var libPath = match.Groups[1].Value.Replace(@"\\", @"\");
                            if (Directory.Exists(libPath) && !_knownRoots.Contains(libPath, StringComparer.OrdinalIgnoreCase))
                            {
                                _knownRoots.Add(libPath);
                            }
                        }
                    }
                }
                catch { }
            }
        }

        // All logical drive roots
        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (drive.IsReady && !_knownRoots.Contains(drive.RootDirectory.FullName, StringComparer.OrdinalIgnoreCase))
                {
                    _knownRoots.Add(drive.RootDirectory.FullName);
                }
            }
        }
        catch { }
    }

    public string ToPlaceholderPath(string fullPath)
    {
        var normalized = Path.GetFullPath(fullPath);
        // Replace longest matching directory placeholder first
        foreach (var kvp in _placeholders.OrderByDescending(p => p.Value.Length))
        {
            if (normalized.StartsWith(kvp.Value, StringComparison.OrdinalIgnoreCase))
            {
                var rel = normalized.Substring(kvp.Value.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                return $"{kvp.Key}/{rel.Replace('\\', '/')}";
            }
        }
        return normalized.Replace('\\', '/');
    }

    private List<string> ResolvePatterns(string rawPath)
    {
        var candidates = new List<string> { rawPath };

        // 1. Expand <root> placeholder
        if (rawPath.Contains("<root>", StringComparison.OrdinalIgnoreCase))
        {
            var next = new List<string>();
            foreach (var c in candidates)
            {
                foreach (var r in _knownRoots)
                {
                    next.Add(c.Replace("<root>", r, StringComparison.OrdinalIgnoreCase));
                }
            }
            candidates = next;
        }

        // 2. Expand directory placeholders
        var expanded = new List<string>();
        foreach (var c in candidates)
        {
            var s = c;
            foreach (var kvp in _placeholders)
            {
                if (s.Contains(kvp.Key, StringComparison.OrdinalIgnoreCase))
                {
                    s = s.Replace(kvp.Key, kvp.Value, StringComparison.OrdinalIgnoreCase);
                }
            }

            // 3. Expand <storeUserId> to wildcard '*'
            if (s.Contains("<storeUserId>", StringComparison.OrdinalIgnoreCase))
            {
                s = s.Replace("<storeUserId>", "*", StringComparison.OrdinalIgnoreCase);
            }

            // Normalize all slashes to backslashes
            s = s.Replace('/', '\\');
            expanded.Add(s);
        }

        return expanded.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>
    /// Reads Steam's remotecache.vdf directly for Auto-Cloud save files for a given Steam AppId
    /// </summary>
    public List<string> GetSteamRemoteCacheFiles(int appId)
    {
        var matchedFiles = new List<string>();
        var strAppId = appId.ToString();

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var localAppDataLow = Path.Combine(home, "AppData", "LocalLow");
        var winDocuments = Path.Combine(home, "Documents");
        var winSavedGames = Path.Combine(home, "Saved Games");
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);

        foreach (var steamRoot in _steamRoots)
        {
            var userdataDir = Path.Combine(steamRoot, "userdata");
            if (!Directory.Exists(userdataDir)) continue;

            try
            {
                var userDirs = Directory.GetDirectories(userdataDir);
                foreach (var userDir in userDirs)
                {
                    var vdfPath = Path.Combine(userDir, strAppId, "remotecache.vdf");
                    if (!File.Exists(vdfPath)) continue;

                    var lines = File.ReadAllLines(vdfPath);
                    string? currentFile = null;
                    string? currentRoot = null;

                    foreach (var rawLine in lines)
                    {
                        var line = rawLine.Trim();
                        if (string.IsNullOrEmpty(line)) continue;

                        var fileMatch = Regex.Match(line, @"^""([^""]+)""$");
                        if (fileMatch.Success)
                        {
                            var key = fileMatch.Groups[1].Value;
                            if (key != "ChangeNumber" && key != "OSType" && key != strAppId)
                            {
                                if (!string.IsNullOrEmpty(currentFile) && currentRoot != null)
                                {
                                    AddCandidateFile(currentFile, currentRoot, steamRoot, userDir, strAppId, matchedFiles);
                                }
                                currentFile = key;
                                currentRoot = null;
                            }
                            continue;
                        }

                        var propMatch = Regex.Match(line, @"^""([^""]+)""\s+""([^""]*)""$");
                        if (propMatch.Success && currentFile != null)
                        {
                            var k = propMatch.Groups[1].Value.ToLowerInvariant();
                            var v = propMatch.Groups[2].Value;
                            if (k == "root")
                            {
                                currentRoot = v;
                            }
                        }
                    }

                    if (!string.IsNullOrEmpty(currentFile) && currentRoot != null)
                    {
                        AddCandidateFile(currentFile, currentRoot, steamRoot, userDir, strAppId, matchedFiles);
                    }
                }
            }
            catch { }
        }

        return matchedFiles.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private void AddCandidateFile(string relPath, string root, string steamRoot, string userDir, string appId, List<string> results)
    {
        var baseName = Path.GetFileName(relPath);
        if (IgnoredFiles.Contains(baseName)) return;

        var cleanRel = relPath.Replace('/', '\\');
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var localAppDataLow = Path.Combine(home, "AppData", "LocalLow");
        var winDocuments = Path.Combine(home, "Documents");
        var winSavedGames = Path.Combine(home, "Saved Games");
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);

        var candidates = new List<string>();

        switch (root)
        {
            case "0":
                candidates.Add(Path.Combine(userDir, appId, "remote", cleanRel));
                break;
            case "1":
                candidates.Add(Path.Combine(winDocuments, cleanRel));
                candidates.Add(Path.Combine(userDir, appId, "remote", cleanRel));
                break;
            case "2":
                candidates.Add(Path.Combine(winDocuments, cleanRel));
                break;
            case "3":
                candidates.Add(Path.Combine(localAppData, cleanRel));
                break;
            case "4":
                candidates.Add(Path.Combine(appData, cleanRel));
                break;
            case "5":
                candidates.Add(Path.Combine(winSavedGames, cleanRel));
                break;
            case "6":
                candidates.Add(Path.Combine(programData, cleanRel));
                break;
            case "12":
                candidates.Add(Path.Combine(localAppDataLow, cleanRel));
                break;
            default:
                candidates.Add(Path.Combine(userDir, appId, "remote", cleanRel));
                candidates.Add(Path.Combine(appData, cleanRel));
                candidates.Add(Path.Combine(localAppData, cleanRel));
                break;
        }

        foreach (var cand in candidates)
        {
            if (File.Exists(cand))
            {
                results.Add(cand);
            }
        }
    }

    public Task<DetectedGame?> ScanGameAsync(GameEntry game)
    {
        return Task.Run(() =>
        {
            if (game == null) return null;

            var matchedFiles = new List<string>();

            // 1. Check Steam RemoteCache directly if Steam AppId exists
            var steamAppId = game.GetSteamAppId();
            if (steamAppId.HasValue)
            {
                var steamFiles = GetSteamRemoteCacheFiles(steamAppId.Value);
                matchedFiles.AddRange(steamFiles);
            }

            // 2. Scan Manifest savePaths
            foreach (var savePath in game.SavePaths)
            {
                // Verify OS condition
                if (savePath.When != null && savePath.When.Count > 0)
                {
                    var matchWindows = savePath.When.Any(w => string.IsNullOrEmpty(w.Os) || w.Os.Equals("windows", StringComparison.OrdinalIgnoreCase));
                    if (!matchWindows) continue;
                }

                var patterns = ResolvePatterns(savePath.Path);
                foreach (var pattern in patterns)
                {
                    var files = FindMatchingFiles(pattern);
                    matchedFiles.AddRange(files);
                }
            }

            var uniqueFiles = matchedFiles.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (uniqueFiles.Count == 0) return null;

            long totalSize = 0;
            DateTime? latestTime = null;
            var fileDetails = new List<SaveFileDetail>();

            foreach (var file in uniqueFiles)
            {
                var baseName = Path.GetFileName(file);
                if (IgnoredFiles.Contains(baseName)) continue;

                try
                {
                    var fi = new FileInfo(file);
                    if (!fi.Exists) continue;

                    totalSize += fi.Length;
                    if (!latestTime.HasValue || fi.LastWriteTime > latestTime.Value)
                    {
                        latestTime = fi.LastWriteTime;
                    }

                    fileDetails.Add(new SaveFileDetail
                    {
                        AbsolutePath = fi.FullName,
                        PlaceholderPath = ToPlaceholderPath(fi.FullName),
                        Size = fi.Length,
                        LastWriteTime = fi.LastWriteTime
                    });
                }
                catch { }
            }

            if (fileDetails.Count == 0) return null;

            return new DetectedGame
            {
                Id = game.Id,
                Name = game.Name,
                SteamId = steamAppId,
                FileCount = fileDetails.Count,
                TotalSizeBytes = totalSize,
                LastModified = latestTime,
                Files = fileDetails,
                Status = SyncStatus.LocalOnly
            };
        });
    }

    private List<string> FindMatchingFiles(string pattern)
    {
        var results = new List<string>();
        try
        {
            var normalizedPattern = pattern.Trim().Replace('/', '\\');
            var parts = normalizedPattern.Split(Path.DirectorySeparatorChar);

            int baseIndex = 0;
            while (baseIndex < parts.Length && !parts[baseIndex].Contains('*') && !parts[baseIndex].Contains('?'))
            {
                baseIndex++;
            }

            var baseDir = string.Join(Path.DirectorySeparatorChar, parts.Take(baseIndex));
            if (string.IsNullOrEmpty(baseDir))
            {
                return results;
            }

            var globRemainder = parts.Skip(baseIndex).ToArray();

            // Case A: No wildcards at all
            if (globRemainder.Length == 0)
            {
                if (File.Exists(baseDir))
                {
                    results.Add(baseDir);
                }
                else if (Directory.Exists(baseDir))
                {
                    GetAllFilesInDirectory(baseDir, results);
                }
                return results;
            }

            // Case B: Has wildcards
            if (!Directory.Exists(baseDir))
            {
                return results;
            }

            void Traverse(string currentDir, int index)
            {
                if (index >= globRemainder.Length)
                {
                    if (File.Exists(currentDir))
                    {
                        results.Add(currentDir);
                    }
                    else if (Directory.Exists(currentDir))
                    {
                        GetAllFilesInDirectory(currentDir, results);
                    }
                    return;
                }

                if (!Directory.Exists(currentDir)) return;

                var segment = globRemainder[index];
                var isWildcard = segment.Contains('*') || segment.Contains('?');

                if (segment == "**")
                {
                    Traverse(currentDir, index + 1);
                    try
                    {
                        foreach (var sub in Directory.GetDirectories(currentDir))
                        {
                            Traverse(sub, index);
                        }
                    }
                    catch { }
                }
                else if (isWildcard)
                {
                    try
                    {
                        var regexStr = "^" + Regex.Escape(segment).Replace(@"\*", ".*").Replace(@"\?", ".") + "$";
                        var regex = new Regex(regexStr, RegexOptions.IgnoreCase);

                        foreach (var file in Directory.GetFiles(currentDir))
                        {
                            if (regex.IsMatch(Path.GetFileName(file)))
                            {
                                Traverse(file, index + 1);
                            }
                        }

                        foreach (var dir in Directory.GetDirectories(currentDir))
                        {
                            if (regex.IsMatch(Path.GetFileName(dir)))
                            {
                                Traverse(dir, index + 1);
                            }
                        }
                    }
                    catch { }
                }
                else
                {
                    var next = Path.Combine(currentDir, segment);
                    if (File.Exists(next) || Directory.Exists(next))
                    {
                        Traverse(next, index + 1);
                    }
                }
            }

            Traverse(baseDir, 0);
        }
        catch { }

        return results.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private void GetAllFilesInDirectory(string dir, List<string> results)
    {
        try
        {
            foreach (var f in Directory.GetFiles(dir))
            {
                results.Add(f);
            }
            foreach (var d in Directory.GetDirectories(dir))
            {
                GetAllFilesInDirectory(d, results);
            }
        }
        catch { }
    }

    public async Task<List<DetectedGame>> ScanGamesAsync(IEnumerable<GameEntry> games, IProgress<(int current, int total, string currentName)>? progress = null)
    {
        var detected = new List<DetectedGame>();
        var list = games.ToList();
        int count = 0;
        int total = list.Count;

        foreach (var game in list)
        {
            count++;
            progress?.Report((count, total, game.Name));
            var result = await ScanGameAsync(game);
            if (result != null)
            {
                detected.Add(result);
            }
        }

        return detected;
    }

    public async Task<List<DetectedGame>> GetDetectedGamesAsync(IReadOnlyList<GameEntry> allGames, bool forceRescan = false, IProgress<(int current, int total, string currentName)>? progress = null)
    {
        var cachePath = Path.Combine(_configService.CacheDir, "detected_games.json");

        if (!forceRescan && File.Exists(cachePath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(cachePath);
                var cachedIds = JsonSerializer.Deserialize<List<string>>(json);
                if (cachedIds != null && cachedIds.Count > 0)
                {
                    var idSet = new HashSet<string>(cachedIds, StringComparer.OrdinalIgnoreCase);
                    var candidates = allGames.Where(g => idSet.Contains(g.Id)).ToList();
                    var results = await ScanGamesAsync(candidates, progress);
                    if (results.Count > 0)
                    {
                        return results;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ScannerService] Error reading detected cache: {ex.Message}");
            }
        }

        // Full scan across all games
        var detected = await ScanGamesAsync(allGames, progress);

        try
        {
            var ids = detected.Select(d => d.Id).ToList();
            var json = JsonSerializer.Serialize(ids, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(cachePath, json);
        }
        catch { }

        return detected;
    }
}
