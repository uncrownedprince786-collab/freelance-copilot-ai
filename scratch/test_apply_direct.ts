import { updateTrackingStatusAction, getOpportunities } from '../src/app/actions/opportunity-actions.ts';
import { prisma } from '../src/lib/db.ts';

async function main() {
  // Find a visible opportunity (no tracking)
  const opp = await prisma.opportunity.findFirst({
    where: { tracking: { is: null } },
    select: { id: true, title: true },
  });

  if (!opp) {
    console.log('No visible opportunity found.');
    return;
  }
  console.log('Testing opportunity:', opp.id, opp.title);
  const res = await updateTrackingStatusAction(opp.id, 'APPLIED');
  console.log('Update result:', res);
  const list = await getOpportunities({ sortBy: 'date', page: 1, limit: 15 });
  const still = (list.data as any[]).some(item => item.id === opp.id);
  console.log('Still appears in feed after apply?', still);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
