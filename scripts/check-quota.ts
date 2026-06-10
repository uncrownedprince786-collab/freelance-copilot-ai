import * as fs from 'fs';
import * as path from 'path';

const quotaFile = path.join(process.cwd(), '.upwork-quota.json');

function checkQuota() {
  if (!fs.existsSync(quotaFile)) {
    console.log('\n📊 No quota data found. Run sync first.\n');
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(quotaFile, 'utf-8'));
  const lastReset = new Date(data.lastReset);
  const today = new Date();
  const searchesUsed = data.searchesUsed || 0;
  const remaining = 100 - searchesUsed;
  
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     UPWORK API QUOTA STATUS          ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Used:      ${searchesUsed}/100                  ║`);
  console.log(`║ Remaining: ${remaining}                    ║`);
  console.log(`║ Usage:     ${((searchesUsed / 100) * 100).toFixed(1)}%                     ║`);
  
  if (lastReset.toDateString() !== today.toDateString()) {
    console.log('╠════════════════════════════════════════╣');
    console.log('║ 🔄 Quota resets TODAY!                ║');
  } else if (remaining < 20) {
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ ⚠️  Only ${remaining} searches left!      ║`);
  }
  
  console.log('╚════════════════════════════════════════╝\n');
}

checkQuota();