import * as dotenv from 'dotenv';
dotenv.config();

async function testProposal() {
  const url = 'https://upwork-proposal-generator-ai.p.rapidapi.com/generate';
  const options = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rapidapi-key': process.env.RAPID_API_KEY as string,
      'x-rapidapi-host': 'upwork-proposal-generator-ai.p.rapidapi.com'
    },
    body: JSON.stringify({
      temperature: 0,
      About: "I am a skilled Flutter developer."
    })
  };

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
  }
}

testProposal();
