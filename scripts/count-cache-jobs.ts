import * as fs from 'fs';
import * as path from 'path';

function countJobs() {
  const cacheFile = path.join(process.cwd(), '.jobs-cache.json');
  if (!fs.existsSync(cacheFile)) {
    console.log('Cache file does not exist.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  const jobs = data.jobs || [];

  const upwork = jobs.filter((j: any) => j.source === 'upwork' || j.platform === 'Upwork');
  const freelancer = jobs.filter((j: any) => j.source === 'freelancer' || j.platform === 'Freelancer');
  const google = jobs.filter((j: any) => j.source === 'google');

  console.log(`Total jobs in cache: ${jobs.length}`);
  console.log(`Upwork jobs count: ${upwork.length}`);
  console.log(`Freelancer jobs count: ${freelancer.length}`);
  console.log(`Google jobs count: ${google.length}`);

  if (upwork.length > 0) {
    console.log('\nSample Upwork jobs titles:');
    upwork.slice(0, 5).forEach((j: any, i: number) => {
      console.log(`${i + 1}. [${j.postedAt}] ${j.title} (${j.clientName}, ${j.country})`);
    });
  }
}

countJobs();
