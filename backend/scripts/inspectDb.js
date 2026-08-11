// scripts/inspectDb.js
//
//   node scripts/inspectDb.js
//
// READ-ONLY. Prints what is already in the database so you can see what you're
// working with before changing anything. It never writes, updates or deletes.
//
// Useful for answering:
//   - Did I connect to the right database?
//   - What claims already exist, and what shape is their data?
//   - Is `ocrData` an array (what the UI expects) or an object (what the schema
//     now defines)? See BACKEND_GUIDE.md §9.

import 'dotenv/config';
import mongoose from 'mongoose';

const describeShape = (value) => {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object{${Object.keys(value).length} keys}`;
  return typeof value;
};

async function inspect() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Create backend/.env first (see .env.example).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log(`\nConnected to database: "${mongoose.connection.name}"`);
  if (mongoose.connection.name === 'test') {
    console.log('  ⚠️  "test" is MongoDB\'s default — your MONGO_URI is probably missing');
    console.log('      the database name. It goes between the "/" and the "?".');
  }

  const collections = await db.listCollections().toArray();
  console.log(`\nCollections in this database (${collections.length}):`);
  for (const c of collections) {
    const count = await db.collection(c.name).countDocuments();
    console.log(`  ${c.name.padEnd(28)} ${count} document(s)`);
  }

  const claims = await db.collection('claims').find().toArray();
  console.log(`\n--- claims collection: ${claims.length} claim(s) ---`);

  for (const claim of claims) {
    console.log(`\n  ${claim.id || '(no id field!)'}`);
    console.log(`    policyholder   ${claim.policyholder ?? '—'}`);
    console.log(`    claimType      ${claim.claimType ?? '—'}`);
    console.log(`    status         ${claim.status ?? '—'}`);
    console.log(`    docsCount      ${claim.docsCount ?? '—'}`);
    console.log(`    documents      ${describeShape(claim.documents)}`);

    (claim.documents || []).forEach((doc) => {
      console.log(`       • ${doc.fileName || doc.title || doc.id} `
        + `[type=${doc.type ?? '—'}] `
        + `[fileUrl=${doc.fileUrl ?? '—'}]`);
    });

    // The shape mismatch that breaks the OCR panels in the UI.
    const ocrShape = describeShape(claim.ocrData);
    const uiCompatible = Array.isArray(claim.ocrData) || claim.ocrData == null;
    console.log(`    ocrData        ${ocrShape}  ${uiCompatible ? '' : '⚠️  object — the frontend expects an array'}`);
    if (claim.ocrData && !Array.isArray(claim.ocrData)) {
      console.log(`                   keys: ${Object.keys(claim.ocrData).join(', ')}`);
    }

    console.log(`    rules          ${describeShape(claim.rules)}`);
    console.log(`    createdAt      ${claim.createdAt ?? '— (GET /api/claims sorts by this)'}`);
  }

  console.log('\nNothing was modified — this script only reads.\n');
  await mongoose.disconnect();
  process.exit(0);
}

inspect().catch((err) => {
  console.error('\nCould not inspect the database:', err.message);
  if (/authentication failed/i.test(err.message)) {
    console.error('→ Wrong database username or password. This is a Database Access');
    console.error('  user, NOT your Atlas login. If the password has special characters');
    console.error('  (@ : / ? # [ ] %) they must be percent-encoded in the URI.');
  }
  if (/timed out|ETIMEDOUT|ENOTFOUND|querySrv/i.test(err.message)) {
    console.error('→ Could not reach the cluster. Usually the IP allowlist:');
    console.error('  Atlas → Database & Network Access → IP Access List →');
    console.error('  Add IP Address → ADD CURRENT IP ADDRESS.');
  }
  process.exit(1);
});
