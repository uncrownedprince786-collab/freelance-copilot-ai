async function testRss() {
  const url = 'https://www.upwork.com/ab/feed/jobs/rss?q=flutter';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log('Status', res.status);
    const text = await res.text();
    console.log('Body length', text.length);
    console.log(text.substring(0, 500));
  } catch (err) {
    console.error(err);
  }
}
testRss();
