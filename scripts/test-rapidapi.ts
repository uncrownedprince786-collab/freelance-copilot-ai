import * as dotenv from 'dotenv';
dotenv.config();

async function testRapidAPI() {
  const url = 'https://upwork-jobs.p.rapidapi.com/jobs?query=flutter';
  const options = {
    method: 'GET',
    headers: {
      'x-rapidapi-key': process.env.RAPID_API_KEY as string,
      'x-rapidapi-host': 'upwork-jobs.p.rapidapi.com'
    }
  };

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
  }
}

testRapidAPI();
