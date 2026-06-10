import { prisma } from '../src/lib/db';

async function main() {
  const opp = await prisma.opportunity.findFirst({
    where: {
      tracking: { is: null }
    },
    select: { id: true }
  });
  console.log('Opportunity ID:', opp?.id ?? 'none');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
