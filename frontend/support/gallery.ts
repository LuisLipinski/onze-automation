import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deterministic 256x256 PNG; only the gallery fixture is synthetic.
const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAFNUlEQVR4nO3TsQ2AQAADsZ+OcdgeIVExxhWO5AFSXM65rwk93zuhkxeAywvA7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYC2A+wAtB1gB6DtADsAbQfYAWg7wA5A2wF2ANoOsAPQdoAdgLYD7AC0HWAHoO0AOwBtB9gBaDvADkDbAXYA2g6wA9B2gB2AtgPsALQdYAeg7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYC2A+wAtB1gB6DtADsAbQfYAWg7wA5A2wF2ANoOsAPQdoAdgLYD7AC0HWAHoO0AOwBtB9gBaDvADkDbAXYA2g6wA9B2gB2AtgPsALQdYAeg7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYC2A+wAtB1gB6DtADsAbQfYAWg7wA5A2wF2ANoOsAPQdoAdgLYD7AC0HWAHoO0AOwBtB9gBaDvADkDbAXYA2g6wA9B2gB2AtgPsALQdYAeg7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYC2A+wAtB1gB6DtADsAbQfYAWg7wA5A2wF2ANoOsAPQdoAdgLYD7AC0HWAHoO0AOwBtB9gBaDvADkDbAXYA2g6wA9B2gB2AtgPsALQdYAeg7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYC2A+wAtB1gB6DtADsAbQfYAWg7wA5A2wF2ANoOsAPQdoAdgLYD7AC0HWAHoO0AOwBtB9gBaDvADkDbAXYA2g6wA9B2gB2AtgPsALQdYAeg7QA7AG0H2AFoO8AOQNsBdgDaDrAD0HaAHYB28gW4/IG6vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF4PICcH0BuLwAXF8ALi8A1xeAywvA9QXg8gJwfQG4vABcXwAuLwDXF4DLC8D1BeDyAnB9Abi8AFxfAC4vANcXgMsLwPUF2H5hPRsE/ArpUAAAAABJRU5ErkJggg==', 'base64');
export function seedGallery() {
  const directory = mkdtempSync(join(tmpdir(), 'onze-gallery-'));
  const file = join(directory, 'onze-automation-logo.png');
  writeFileSync(file, logo);
  try {
    execFileSync('adb', ['shell', 'mkdir', '-p', '/sdcard/Pictures'], { timeout: 10_000 });
    execFileSync('adb', ['push', file, '/sdcard/Pictures/onze-automation-logo.png'], { timeout: 10_000 });
    execFileSync('adb', ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d', 'file:///sdcard/Pictures/onze-automation-logo.png'], { timeout: 10_000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
