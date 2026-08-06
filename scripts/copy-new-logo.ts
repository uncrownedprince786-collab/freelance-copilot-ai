import * as fs from 'fs';
import * as path from 'path';

function copyNewLogo() {
  const sourcePath = 'C:\\Users\\NEW TECH\\.gemini\\antigravity\\brain\\576cb173-e99f-41d1-a92a-af7b56065b02\\.user_uploaded\\media__1785411543721.png';
  const publicDir = path.join(process.cwd(), 'public');
  const appDir = path.join(process.cwd(), 'src', 'app');

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(publicDir, 'logo.png'));
    fs.copyFileSync(sourcePath, path.join(publicDir, 'favicon.ico'));
    if (fs.existsSync(appDir)) {
      fs.copyFileSync(sourcePath, path.join(appDir, 'favicon.ico'));
    }
    console.log('New logo and favicon successfully updated in public/ and src/app/');
  } else {
    console.warn('Source logo file not found at:', sourcePath);
  }
}

copyNewLogo();
