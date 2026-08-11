import "server-only";
import os from 'os';
import path from 'path';
import fs from 'fs';

export function getStoragePath(filename: string): string {
  const tmpPath = path.join(os.tmpdir(), filename);
  if (fs.existsSync(tmpPath)) {
    return tmpPath;
  }
  const cwdPath = path.join(/* turbopackIgnore: true */ process.cwd(), filename);
  if (fs.existsSync(cwdPath)) {
    try {
      fs.copyFileSync(cwdPath, tmpPath);
      return tmpPath;
    } catch {
      return cwdPath;
    }
  }
  return tmpPath;
}
