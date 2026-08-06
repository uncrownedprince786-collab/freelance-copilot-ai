require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');

const dbPath = path.resolve(process.cwd(), './prisma/dev.db');
console.log('DB path:', dbPath);

const adapter = new PrismaBetterSqlite3({ url: dbPath });
console.log('Adapter created OK:', typeof adapter);

const prisma = new PrismaClient({ adapter });
console.log('PrismaClient created OK');

prisma.opportunity.count()
  .then(c => {
    console.log('COUNT:', c);
    return prisma.$disconnect();
  })
  .then(() => console.log('ALL OK — DB pipeline works!'))
  .catch(e => {
    console.error('ERROR at query:', e.message);
    console.error(e.stack);
    process.exit(1);
  });
