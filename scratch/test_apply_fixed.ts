import { updateTrackingStatusAction, getOpportunities } from '../../src/app/actions/opportunity-actions';
import { prisma } from '../../src/lib/db';

async function main() {
  // Fetch a visible opportunity (no tracking)
  const opp = await prisma.opportunity.findFirst({
    where: {
      tracking: { is: null },
    },
    select: { id: true, title: true },
  });
  if (!opp) {
    console.log('No opportunity found to test.');
    return;
  }
  console.log('Testing with Opportunity ID:', opp.id, 'Title:', opp.title);

  // Mark as APPLIED
  const res = await updateTrackingStatusAction(opp.id, 'APPLIED');
  console.log('Update result:', res);

  // Fetch opportunities again
  const list = await getOpportunities({});
  const stillExists = (list.data as any[]).some((item) => item.id === opp.id);
  console.log('Opportunity still appears in feed after apply?', stillExists);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
