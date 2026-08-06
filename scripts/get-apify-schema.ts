import * as dotenv from 'dotenv';
dotenv.config();

async function getOpenApi() {
  const token = process.env.APIFY_TOKEN;
  const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/builds/default/openapi.json?token=${token}`;

  try {
    const res = await fetch(endpoint);
    console.log('OpenAPI Status:', res.status);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

getOpenApi();
