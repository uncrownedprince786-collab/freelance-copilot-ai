import * as dotenv from 'dotenv';
dotenv.config();

async function testEndpoints() {
  const apiKey = process.env.RAPID_API_KEY as string;
  console.log('Testing key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');

  // Test 1: Proposal Generator
  console.log('\n--- Testing Proposal Generator ---');
  try {
    const res = await fetch('https://upwork-proposal-generator-ai.p.rapidapi.com/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rapidapi-host': 'upwork-proposal-generator-ai.p.rapidapi.com',
        'x-rapidapi-key': apiKey
      },
      body: JSON.stringify({
        temperature: 0,
        About: "Test project for mobile app development."
      })
    });
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', data);
  } catch (err: any) {
    console.error('Err:', err.message);
  }

  // Test 2: Upwork Jobs
  console.log('\n--- Testing Upwork Jobs ---');
  try {
    const res = await fetch('https://upwork-jobs.p.rapidapi.com/jobs', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-rapidapi-host': 'upwork-jobs.p.rapidapi.com',
        'x-rapidapi-key': apiKey
      }
    });
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', data);
  } catch (err: any) {
    console.error('Err:', err.message);
  }
}

testEndpoints();
