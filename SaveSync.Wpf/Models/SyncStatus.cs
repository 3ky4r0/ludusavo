namespace SaveSync.Desktop.Models;

public enum SyncStatus
{
    Unknown,
    Synced,
    LocalOnly,
    RemoteOnly,
    LocalNewer,
    RemoteNewer,
    Conflict,
    Syncing,
    Error
}
