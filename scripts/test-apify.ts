import * as dotenv from 'dotenv';
dotenv.config();

async function testApify() {
  const token = process.env.APIFY_TOKEN;
  console.log('Testing Apify token:', token ? `${token.substring(0, 10)}...` : 'MISSING');

  const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${token}`;

  const inputPayload = {
    queries: ["flutter", "react", "nextjs"],
    limit: 5
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(inputPayload)
    });

    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response (first 2000 chars):\n', text.substring(0, 2000));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testApify();
