local millennium = require("millennium")
local logger = require("logger")

local function get_plugin_dir()
    -- 1. Try millennium built-in utils module
    local ok, utils = pcall(require, "utils")
    if ok and utils and utils.get_backend_path then
        local bp = utils.get_backend_path()
        if bp then
            local fs_ok, fs = pcall(require, "fs")
            if fs_ok and fs and fs.parent_path then
                return fs.parent_path(bp)
            end
            local parent = bp:match("(.*)[/\\]")
            if parent then return parent end
        end
    end

    -- 2. Try debug info (source file path)
    local info = debug.getinfo(1, "S")
    if info and info.source then
        local src = info.source:gsub("^@", "")
        local dir = src:match("(.*)[/\\]")
        if dir then
            local parent = dir:match("(.*)[/\\]")
            if parent then return parent end
            return dir
        end
    end

    -- 3. Default fallback to standard Millennium plugins directory
    local programFilesX86 = os.getenv("ProgramFiles(x86)") or [[C:\Program Files (x86)]]
    return programFilesX86 .. [[\Steam\millennium\plugins\savesync]]
end

function LaunchSaveSync()
    local plugin_dir = get_plugin_dir()
    logger:info("SaveSync portable plugin directory: " .. tostring(plugin_dir))

    local exe_path = plugin_dir .. [[\SaveSync.exe]]
    
    -- Method 1: LuaJIT FFI ShellExecuteA (Direct Win32 API — 100% silent, zero console window, no cmd.exe)
    local ffi_ok, ffi = pcall(require, "ffi")
    if ffi_ok and ffi then
        pcall(function()
            ffi.cdef[[
                void* ShellExecuteA(void* hwnd, const char* lpOperation, const char* lpFile, const char* lpParameters, const char* lpDirectory, int nShowCmd);
            ]]
        end)
        local ok, res = pcall(function()
            local shell32 = ffi.load("shell32.dll")
            return shell32.ShellExecuteA(nil, "open", exe_path, nil, plugin_dir, 0) -- 0 = SW_HIDE
        end)
        if ok and res ~= nil and tonumber(ffi.cast("intptr_t", res)) > 32 then
            logger:info("SaveSync daemon launched 100% silent via Win32 ShellExecuteA")
            return "ok"
        end
    end

    -- Method 2: Millennium built-in utils.exec (executes with CREATE_NO_WINDOW)
    local utils_ok, utils = pcall(require, "utils")
    if utils_ok and utils and utils.exec then
        local cmd = string.format('start "" /D "%s" "%s"', plugin_dir, exe_path)
        pcall(function() utils.exec(cmd) end)
        logger:info("SaveSync daemon launched silently via utils.exec")
        return "ok"
    end

    -- Method 3: wscript.exe silent execution via SaveSync.vbs
    local vbs_path = plugin_dir .. [[\SaveSync.vbs]]
    local cmd = string.format('wscript.exe //B "%s"', vbs_path)
    os.execute(cmd)
    return "ok"
end

function on_load()
    logger:info("SaveSync Steam Plugin backend loaded")
    pcall(LaunchSaveSync)
    millennium.ready()
end

function on_frontend_loaded()
    logger:info("SaveSync Steam Plugin frontend loaded")
end

function StopSaveSync()
    local cmd = 'curl -s -X POST http://localhost:3636/api/shutdown'
    local utils_ok, utils = pcall(require, "utils")
    if utils_ok and utils and utils.exec then
        pcall(function() utils.exec(cmd) end)
        return "ok"
    end
    local ffi_ok, ffi = pcall(require, "ffi")
    if ffi_ok and ffi then
        pcall(function()
            local shell32 = ffi.load("shell32.dll")
            shell32.ShellExecuteA(nil, "open", "curl", "-s -X POST http://localhost:3636/api/shutdown", nil, 0)
        end)
        return "ok"
    end
    os.execute(cmd)
    return "ok"
end

function on_unload()
    logger:info("SaveSync Steam Plugin backend unloaded, shutting down daemon...")
    pcall(StopSaveSync)
end

return {
    on_load = on_load,
    on_frontend_loaded = on_frontend_loaded,
    on_unload = on_unload,
}
