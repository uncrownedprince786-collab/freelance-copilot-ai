import * as dotenv from 'dotenv';
dotenv.config();

async function testApifyEnrich() {
  const token = process.env.APIFY_TOKEN;
  const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${token}`;

  const inputPayload = {
    query: "", // Empty query to get top recent jobs across all categories
    maxResults: 15,
    sort: "recency"
  };

  console.log('Testing Apify general browse with payload:', inputPayload);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputPayload)
    });

    console.log('Status:', res.status);
    const items = await res.json();
    console.log('Items count:', Array.isArray(items) ? items.length : 0);
    if (Array.isArray(items) && items.length > 0) {
      items.slice(0, 3).forEach((item, idx) => {
        console.log(`\n--- Item ${idx + 1} ---`);
        console.log('Title:', item.title);
        console.log('Client Country:', item.clientCountry);
        console.log('Client Total Spent:', item.clientTotalSpent);
        console.log('Client Rating:', item.clientRating);
        console.log('Client Review Count:', item.clientReviewCount);
        console.log('Connects Required:', item.connectsRequired);
        console.log('Total Applicants / Proposals:', item.totalApplicants);
        console.log('Persons to Hire:', item.personsToHire);
        console.log('Publish Time:', item.publishTime);
        console.log('All keys:', Object.keys(item).join(', '));
      });
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testApifyEnrich();
