import { getJson } from "serpapi";
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  const query = "flutter developer upwork";
  console.log('Searching for:', query);
  const response = await getJson({
    api_key: process.env.SERPAPI_KEY,
    engine: "google_jobs",
    q: query,
    hl: "en",
    gl: "us"
  });
  console.log(JSON.stringify(response.jobs_results?.[0] || {}, null, 2));
}
test();
