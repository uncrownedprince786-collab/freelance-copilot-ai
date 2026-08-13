const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const token = (env.match(/APIFY_TOKEN=([^\r\n]+)/) || [])[1];
if (!token) { console.log('NO_APIFY_TOKEN'); process.exit(0); }
(async () => {
  const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${token}`;
  const queries = ['full stack developer', 'react developer'];
  for (const query of queries) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, maxResults: 12, sort: 'recency' }) });
      if (!res.ok) { console.log('query', query, 'status', res.status); continue; }
      const items = await res.json();
      if (!Array.isArray(items)) { console.log('query', query, 'not array'); continue; }
      console.log('=== query', query, 'count', items.length, '===');
      for (const it of items) {
        const id = it.jobId || it.contentHash || (it.url || '');
        if (String(id).includes('2087571653922326079')) {
          console.log('FOUND TARGET JOB. Keys:', Object.keys(it).join(', '));
          for (const k of Object.keys(it)) {
            if (/propos|applicant|bid|interview|invite|hire|count/i.test(k)) console.log('  ', k, '=', JSON.stringify(it[k]));
          }
        }
      }
      // Also dump proposal-related field names for first item
      if (items[0]) {
        console.log('first item proposal-ish keys:', Object.keys(items[0]).filter(k => /propos|applicant|bid|interview|invite|hire|count/i.test(k)).join(', '));
      }
    } catch (e) { console.log('query', query, 'err', e.message); }
  }
})();
