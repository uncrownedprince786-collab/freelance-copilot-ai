import fetch from 'node-fetch';

async function test() {
  const url = 'https://www.upwork.com/jobs/~0109968d90479ffce9';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('Status', res.status);
    const text = await res.text();
    console.log('Body length', text.length);
    if (text.includes('client')) {
      console.log('Contains client data');
    }
    if (text.includes('Cloudflare') || text.includes('captcha') || text.includes('security')) {
      console.log('Blocked by Cloudflare/Security');
    }
  } catch (err) {
    console.error(err);
  }
}
test();
