// scripts/cleanupDocuments.js
//
// One-off repair for claims that accumulated DUPLICATE documents.
//
//   node scripts/cleanupDocuments.js            → report only, changes nothing
//   node scripts/cleanupDocuments.js --apply    → actually remove the duplicates
//
// WHY THIS EXISTS:
// The old POST /documents route appended unconditionally, so re-uploading a
// document produced a second record with the same `documentType` rather than
// replacing the first. `ocrData.<section>` is a single slot per claim, so only
// the most recent upload's extraction survived, while the UI bound the fields
// to whichever record came FIRST in the array — the stale one. That is the
// "replacing a file does nothing" symptom.
//
// POST now rejects a duplicate with a 409 and the UI has a Remove button, so
// this cannot happen again. This script clears up what the old code left behind.
//
// WHAT IT KEEPS: for each documentType, the MOST RECENTLY uploaded record
// (by `uploadedAt`, falling back to array order). Everything else is removed,
// and its file is deleted from backend/uploads/.
//
// Documents with no `documentType` at all are left completely alone — they
// predate the field and this script cannot tell what they were meant to be.

import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

const APPLY = process.argv.includes('--apply');

// Same permissive model as seedClaims.js: strict:false lets us read and write
// the real documents without keeping a second copy of the 200-line schema here,
// which would inevitably drift from the one in src/server.js.
mongoose.model('Claim', new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
  id: false,
  collection: 'claims'
}));

const uploadedTime = (doc) => {
  const t = Date.parse(doc?.uploadedAt || '');
  return Number.isNaN(t) ? -1 : t;
};

/**
 * Splits a claim's documents into the ones to keep and the ones to drop.
 * Later entries win ties, so the newest upload survives.
 */
function partition(documents) {
  const newestByType = new Map();

  documents.forEach((doc, index) => {
    const type = String(doc.documentType || '').toLowerCase().trim();
    if (!type) return; // untyped legacy document — never touched

    const previous = newestByType.get(type);
    if (
      !previous ||
      uploadedTime(doc) > uploadedTime(previous.doc) ||
      (uploadedTime(doc) === uploadedTime(previous.doc) && index > previous.index)
    ) {
      newestByType.set(type, { doc, index });
    }
  });

  const keptIndexes = new Set([...newestByType.values()].map(entry => entry.index));

  const keep = [];
  const drop = [];
  documents.forEach((doc, index) => {
    const type = String(doc.documentType || '').toLowerCase().trim();
    if (!type || keptIndexes.has(index)) keep.push(doc);
    else drop.push(doc);
  });

  return { keep, drop };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Create backend/.env first (see .env.example).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB — database "${mongoose.connection.name}"\n`);

  if (!APPLY) {
    console.log('DRY RUN — nothing will be changed. Re-run with --apply to remove.\n');
  }

  const Claim = mongoose.model('Claim');
  const claims = await Claim.find();

  let claimsChanged = 0;
  let documentsRemoved = 0;

  for (const claim of claims) {
    const documents = claim.toObject().documents || [];
    const { keep, drop } = partition(documents);

    if (drop.length === 0) continue;

    claimsChanged++;
    documentsRemoved += drop.length;

    console.log(`${claim.id} — removing ${drop.length} duplicate(s), keeping ${keep.length}:`);
    for (const doc of drop) {
      console.log(`    DROP  ${doc.documentType}  ←  ${doc.fileName || doc.title}`);
    }
    for (const doc of keep) {
      if (doc.documentType) console.log(`    keep  ${doc.documentType}  ←  ${doc.fileName || doc.title}`);
    }

    if (!APPLY) {
      console.log();
      continue;
    }

    await Claim.updateOne(
      { id: claim.id },
      { $set: { documents: keep, docsCount: keep.length } }
    );

    // Only bin the files once the database no longer references them.
    for (const doc of drop) {
      if (!doc.storedFileName) continue;
      try {
        fs.unlinkSync(path.join(uploadsDir, doc.storedFileName));
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`    (could not delete ${doc.storedFileName}: ${err.message})`);
      }
    }
    console.log('    → saved\n');
  }

  if (claimsChanged === 0) {
    console.log('No duplicates found. Nothing to do.');
  } else {
    console.log(
      `\n${APPLY ? 'Removed' : 'Would remove'} ${documentsRemoved} document(s) across ${claimsChanged} claim(s).`
    );
    if (!APPLY) console.log('Re-run with --apply to make these changes.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\nCleanup failed:', err.message);
  process.exit(1);
});
