import * as dotenv from 'dotenv';
dotenv.config();

async function testJobs() {
  const apiKey = process.env.RAPID_API_KEY as string;
  console.log('Testing Upwork Jobs API...');

  try {
    const res = await fetch('https://upwork-jobs.p.rapidapi.com/jobs', {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'upwork-jobs.p.rapidapi.com',
        'x-rapidapi-key': apiKey
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response body (first 1000 chars):\n', text.substring(0, 1000));
  } catch (err: any) {
    console.error('Err:', err.message);
  }
}

testJobs();
