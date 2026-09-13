const fs = require('fs');
const path = require('path');

const targetExe = path.join(__dirname, '..', 'SaveSync.exe');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function patch() {
  if (!fs.existsSync(targetExe)) {
    console.error('[patch-subsystem] SaveSync.exe not found at:', targetExe);
    process.exit(1);
  }

  // Wait until Windows Antivirus/Defender releases write lock on the newly built exe
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const fd = fs.openSync(targetExe, 'r+');
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        console.log(`[patch-subsystem] Waiting for Windows file lock to release (attempt ${attempt}/15)...`);
        await sleep(500);
      } else {
        throw err;
      }
    }
  }

  let buf = fs.readFileSync(targetExe);

  // 1. Inject icon-512.ico into SaveSync.exe resources
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-512.ico');
  if (fs.existsSync(iconPath)) {
    try {
      const ResEdit = require('resedit');
      const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
      const exe = ResEdit.NtExecutable.from(buf);
      const res = ResEdit.NtExecutableResource.from(exe);

      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map(i => i.data)
      );

      res.outputResource(exe);
      buf = Buffer.from(exe.generate());
      console.log('[patch-subsystem] Successfully injected icon-512.ico into SaveSync.exe.');
    } catch (iconErr) {
      console.warn('[patch-subsystem] Warning: Could not inject icon:', iconErr.message);
    }
  }

  // 2. Change subsystem to 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)
  const peOffset = buf.readUInt32LE(0x3C);
  const subsystemOffset = peOffset + 24 + 68;
  buf.writeUInt16LE(2, subsystemOffset);

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      fs.writeFileSync(targetExe, buf);
      console.log('[patch-subsystem] Successfully converted SaveSync.exe to GUI Subsystem (No console window).');
      return;
    } catch (err) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 20) {
        console.log(`[patch-subsystem] Target locked, retrying write (${attempt}/20)...`);
        await sleep(500);
      } else {
        throw err;
      }
    }
  }
}

patch().catch(err => {
  console.error('[patch-subsystem] Failed to patch subsystem:', err);
  process.exit(1);
});
