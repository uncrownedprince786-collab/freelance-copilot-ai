import * as dotenv from 'dotenv';
dotenv.config();

async function testApifyRun() {
  const token = process.env.APIFY_TOKEN;
  const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${token}`;

  const inputPayload = {
    query: "flutter mobile app",
    maxResults: 5,
    sort: "recency"
  };

  console.log('Posting payload to Apify:', inputPayload);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(inputPayload)
    });

    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Count returned:', Array.isArray(data) ? data.length : 0);
    if (Array.isArray(data) && data.length > 0) {
      console.log('Sample item keys:', Object.keys(data[0]));
      console.log('Sample item:', JSON.stringify(data[0], null, 2));
    } else {
      console.log('Response body:', data);
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testApifyRun();
