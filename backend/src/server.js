// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import documentsRouter, { uploadsDir } from './routes/documents.js';
import ocrRouter from './routes/ocr.js';
import { buildFraudAdvisory } from './services/fraudAdvisor.js';

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.join(__dirname, '../.env')
});

const mongoUri = process.env.MONGO_URI;
const client = new MongoClient(mongoUri);
await client.connect();

const app = express();
const PORT = process.env.PORT || 5001;
app.use(cors());
app.use(express.json({limit:'10mb'}));

// Serve uploaded files back to the browser, e.g. /uploads/1755-license.jpg.
// Without this the files sit on disk but no <img> or <object> can reach them.
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health',(req,res)=>res.json({ok:true,service:'InsureCopilot API'}));

const claimSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // e.g. "CLM-2026-8891"
  policyholder: String,
  email: String,
  driverName: String,
  vehicle: String,
  claimType: { 
    type: String, 
    enum: ['Own Damage', 'Third-Party Property Damage', 'Third-Party Bodily Injury / Death']
  },
  status: String,
  category: String,
  claimedAmount: Number,
  recommendedPayout: Number,   // what the AI suggested
  isFlagged: Boolean,
  flagSummary: String,
  docsCount: Number,
  documents: [mongoose.Schema.Types.Mixed],
  rules: [mongoose.Schema.Types.Mixed],
  citation: String,

  // --- ADJUSTER DECISION -------------------------------------------------
  // These four used to live only in React state, so approving or denying a
  // claim looked like it worked until the page was refreshed and everything
  // reverted. They are written by PATCH /api/claims/:claimId below.
  approvedPayout: Number,      // what the adjuster actually signed off
  decisionReason: String,      // the denial reason, or the payout-override note
  decidedAt: Date,
  // The requirement labels the adjuster has ticked off. Stored as labels rather
  // than indexes so reordering claimRequirements.js can't shift the ticks onto
  // the wrong rows.
  confirmedRequirements: [String],

  // --- FRAUD ADVISORY ----------------------------------------------------
  // The output of services/fraudAdvisor.js, written ONLY by
  // POST /api/claims/:claimId/fraud-review below. Mixed because the shape is
  // owned by the advisor and evolves with the rule catalogue; pinning it here
  // would mean two definitions that drift.
  //
  // Deliberately NOT in PATCHABLE_CLAIM_FIELDS. It is a machine-produced
  // assessment, not an adjuster-editable field — the same treatment `documents`
  // and `ocrData` already get, each with its own route.
  fraudAdvisory: mongoose.Schema.Types.Mixed,

  // The agent's acknowledgement when they approve a claim that has an
  // outstanding advisory. `indicatorCodes` is a SNAPSHOT taken at the moment of
  // approval: re-running the advisory afterwards must not be able to rewrite
  // what the agent was actually looking at when they signed.
  //
  // Guardrail 3: this records that the warning was seen. It never blocks it.
  fraudAcknowledgement: {
    acknowledgedBy: String,
    note: String,
    acknowledgedAt: Date,
    advisoryState: String,
    indicatorCodes: [String],
    engineVersion: String
  },

  // All fields initialize as null. The OCR will inject data here.
  ocrData: {
    // 1. Motor Claim Form (Mapped exactly to your FIELD_DEFINITIONS)
    motorClaimForm: {
      // Section 2 — Assured's Details
      assured_full_name: { type: String, default: null },
      assured_dob: { type: String, default: null }, // Stored as string to match MM/DD/YYYY format easily, or switch to Date
      assured_place_of_birth: { type: String, default: null },
      assured_sex: { type: String, default: null },
      assured_nationality: { type: String, default: null },
      assured_id_type: { type: String, default: null },
      assured_id_no: { type: String, default: null },
      assured_tin_sss_gsis: { type: String, default: null },
      assured_email: { type: String, default: null },
      assured_mobile: { type: String, default: null },
      assured_home_phone: { type: String, default: null },
      assured_address: { type: String, default: null },
      assured_source_of_fund: { type: String, default: null },
      assured_is_pep: { type: String, default: null }, // Could be Boolean, but String allows "Yes/No" parsing

      // Section 3 — Insured Vehicle's Information
      vehicle_year: { type: String, default: null },
      vehicle_model: { type: String, default: null },
      vehicle_make: { type: String, default: null },
      vehicle_type: { type: String, default: null },
      vehicle_engine_no: { type: String, default: null },
      vehicle_registered_owner: { type: String, default: null },
      vehicle_chassis_no: { type: String, default: null },
      vehicle_plate_no: { type: String, default: null },

      // Section 4 — Driver's Information
      driver_full_name: { type: String, default: null },
      driver_age: { type: String, default: null },
      driver_license_type: { type: String, default: null },
      driver_license_no: { type: String, default: null },
      driver_license_expiry: { type: String, default: null },
      driver_address: { type: String, default: null },
      driver_is_employee: { type: String, default: null },
      driver_relationship: { type: String, default: null },
      driver_authorized_by: { type: String, default: null },

      // Section 5 — Details of the Accident or Loss
      accident_date: { type: String, default: null },
      accident_time: { type: String, default: null },
      accident_weather: { type: String, default: null },
      accident_place: { type: String, default: null },
      accident_police_authority: { type: String, default: null },

      // Section 6 — Additional Details
      nature_of_business: { type: String, default: null },
      purpose_of_use: { type: String, default: null },
      vehicle_used_for_hire: { type: String, default: null },
      registered_in_pami_tnvs: { type: String, default: null },
      direction_during_accident: { type: String, default: null },
      speed_rate_vehicle: { type: String, default: null },
      direction_other_party: { type: String, default: null },
      speed_rate_other_party: { type: String, default: null },
      party_at_fault: { type: String, default: null },
      settlements_made: { type: String, default: null },

      // Section 7 — Reason for Late Filing
      reason_for_late_filing: { type: String, default: null },

      // Section 8 & 9 — Tables
      affected_persons: [{ type: mongoose.Schema.Types.Mixed, default: null }],
      description_of_damage: [{ type: mongoose.Schema.Types.Mixed, default: null }],
      current_location_of_vehicle: { type: String, default: null },

      // Payment & Authorization
      payment_bank_name: { type: String, default: null },
      payment_account_number: { type: String, default: null },
      payment_account_name: { type: String, default: null },
      authorization_text: { type: String, default: null }
    },

    // 2. Other Core Documents
    policeReportOrAffidavit: {
      reportDate: { type: Date, default: null },
      reportingOfficer: { type: String, default: null },
      incidentSummary: { type: String, default: null }
    },
    certificateOfRegistration: {
      registeredOwner: { type: String, default: null },
      plateNumber: { type: String, default: null },
      makeAndModel: { type: String, default: null },
      engineNumber: { type: String, default: null },
      orReceiptDate: { type: Date, default: null }
    },
    driversLicense: {
      driver_license_number: { type: String, default: null },
      driver_license_name: { type: String, default: null },
      driver_license_dob: { type: String, default: null },
      driver_license_address: { type: String, default: null },
      driver_license_class: { type: String, default: null },
      // driver_license_type: { type: String, default: null },
      // The Issue Date box in DriverLicenseEditor has always existed, but this
      // field was commented out — so PATCH /ocr had nowhere to store the value
      // and the input was dead. Declared here, it now round-trips. Must stay in
      // step with frontend/src/data/ocrSchema.js, which is what makes the value
      // readable back out.
      driver_license_issue_date: { type: String, default: null },
      driver_license_expiry_date: { type: String, default: null },
      driver_license_restrictions: { type: String, default: null },
      driver_license_place_of_issue: { type: String, default: null },
      driver_license_control_no: { type: String, default: null },
      driver_license_blood_type: { type: String, default: null },
      driver_license_official_receipt: { type: String, default: null }
    },
    repairEstimate: {
      shopName: { type: String, default: null },
      estimateDate: { type: Date, default: null },
      totalEstimatedCost: { type: Number, default: null },
      detectedParts: [{ type: String, default: null }] 
    },
    certificateOfNoClaim: {
      thirdPartyInsurerName: { type: String, default: null },
      issueDate: { type: Date, default: null },
      confirmationStatus: { type: String, default: null }
    },
    authorizationLetter: {
      authorizedDriverName: { type: String, default: null },
      ownerName: { type: String, default: null },
      authorizationDate: { type: Date, default: null }
    },

    // 3. Third-Party / Medical / Death Claim Documents
    medicalCertificate: {
      patientName: { type: String, default: null },
      attendingPhysician: { type: String, default: null },
      diagnosis: { type: String, default: null },
      treatmentDate: { type: Date, default: null }
    },
    hospitalBillSOA: {
      hospitalName: { type: String, default: null },
      billingDate: { type: Date, default: null },
      totalAmountDue: { type: Number, default: null }
    },
    medicalReceipts: {
      receiptNumbers: [{ type: String, default: null }],
      totalAmountPaid: { type: Number, default: null }
    },
    releaseOfClaimOrDesistance: {
      claimantName: { type: String, default: null },
      settlementAmount: { type: Number, default: null },
      dateSigned: { type: Date, default: null }
    },
    validIdOfClaimant: {
      idType: { type: String, default: null }, 
      idNumber: { type: String, default: null },
      fullName: { type: String, default: null },
      dateOfBirth: { type: Date, default: null }
    },
    deathCertificate: {
      deceasedName: { type: String, default: null },
      dateOfDeath: { type: Date, default: null },
      causeOfDeath: { type: String, default: null }
    },
    birthCertificate: {
      fullName: { type: String, default: null },
      dateOfBirth: { type: Date, default: null },
      parentsNames: { type: String, default: null }
    },
    funeralExpenses: {
      funeralParlorName: { type: String, default: null },
      totalAmount: { type: Number, default: null },
      receiptDate: { type: Date, default: null }
    },
    
    // 4. Vision AI Fallback
    vehicleDamagePictures: {
      damageDescription: { type: String, default: null },
      severity: { type: String, default: null }
    }
  }
}, {
  timestamps: true,
  id: false // Prevents Mongoose's default virtual ID from clashing with your custom "id" string
});

const Claim=mongoose.model('Claim',claimSchema);

app.get('/api/claims',async(req,res)=>{
  try{res.json(await Claim.find().sort({createdAt:-1}));}
  catch(e){res.status(500).json({message:e.message});}
});

// ---------------------------------------------------------------------------
// PATCH /api/claims/:claimId  — the adjuster's decision + checklist
// ---------------------------------------------------------------------------
// Approve / Deny / Edit Payout and the requirement tickboxes used to be React
// state only, so a refresh threw them away. This is the endpoint that makes
// them stick.
//
// Whitelisted, like PATCH /ocr: an unknown key is rejected rather than ignored,
// so a typo surfaces immediately instead of looking like a save that didn't
// take. Everything else about a claim (documents, ocrData) has its own route
// and is deliberately NOT writable here.
const PATCHABLE_CLAIM_FIELDS = [
  'status', 'approvedPayout', 'decisionReason',
  'isFlagged', 'flagSummary', 'confirmedRequirements',
  // The agent's note when approving over an outstanding fraud advisory. This
  // one IS patchable — unlike `fraudAdvisory`, it is something a human wrote.
  'fraudAcknowledgement'
];

const CLAIM_STATUSES = ['In Assessment', 'Completed', 'Denied'];

app.patch('/api/claims/:claimId', async (req, res) => {
  const { claimId } = req.params;
  const patch = req.body;

  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return res.status(400).json({
      message: `Body must be an object with at least one of: ${PATCHABLE_CLAIM_FIELDS.join(', ')}.`
    });
  }

  const unknown = Object.keys(patch).filter(key => !PATCHABLE_CLAIM_FIELDS.includes(key));
  if (unknown.length > 0) {
    return res.status(400).json({
      message: `Cannot update field(s): ${unknown.join(', ')}. Allowed: ${PATCHABLE_CLAIM_FIELDS.join(', ')}.`
    });
  }

  // `status` drives the dashboard tabs and the decision panel, so a typo would
  // hide the claim from every tab. The schema types it as a bare String, so the
  // check has to live here.
  if ('status' in patch && !CLAIM_STATUSES.includes(patch.status)) {
    return res.status(400).json({
      message: `"${patch.status}" is not a valid status. Use one of: ${CLAIM_STATUSES.join(', ')}.`
    });
  }

  if ('confirmedRequirements' in patch && !Array.isArray(patch.confirmedRequirements)) {
    return res.status(400).json({ message: 'confirmedRequirements must be an array of requirement labels.' });
  }

  try {
    const updates = { ...patch };

    // Stamp the decision time whenever the claim is closed, so the audit trail
    // doesn't depend on the frontend remembering to send it.
    if (patch.status === 'Completed' || patch.status === 'Denied') {
      updates.decidedAt = new Date();
    }

    // ...and clear it when the claim is reopened. `decidedAt` is deliberately
    // absent from PATCHABLE_CLAIM_FIELDS: the server owns this timestamp in BOTH
    // directions, so a client can never write a decision time that disagrees
    // with the status it is attached to. A reopened claim showing the date it
    // was decided is exactly the kind of stale field that gets read as fact
    // months later.
    if (patch.status === 'In Assessment') {
      updates.decidedAt = null;
    }

    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedClaim) {
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    return res.json(updatedClaim);
  } catch (err) {
    console.error('Claim update failed:', err);
    if (err.name === 'CastError' || err.name === 'ValidationError') {
      return res.status(400).json({ message: `Could not save: ${err.message}` });
    }
    return res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/claims/:claimId/fraud-review  — run the fraud advisory
// ---------------------------------------------------------------------------
// Runs FR-01 / FR-02 / FR-03 against the claim, persists the result under
// `fraudAdvisory`, and returns the full updated claim so the client can splice
// it in the same way every other mutation here works.
//
// POST rather than GET because it writes and it costs an AI call. Re-running is
// allowed and OVERWRITES: correcting an OCR value and re-checking is the whole
// point of the module, so the advisory has to be replaceable, and a claim must
// never accumulate a pile of stale advisories with no way to tell which is
// current.
//
// It is a route of its own, not a PATCH field, because nothing outside this
// module is allowed to write an advisory. See PATCHABLE_CLAIM_FIELDS.
app.post('/api/claims/:claimId/fraud-review', async (req, res) => {
  const { claimId } = req.params;

  try {
    const claim = await Claim.findOne({ id: claimId }).lean();
    if (!claim) {
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    const fraudAdvisory = await buildFraudAdvisory(Claim, claim);

    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      { $set: { fraudAdvisory } },
      { new: true, runValidators: true }
    );

    return res.json(updatedClaim);
  } catch (err) {
    console.error('Fraud review failed:', err);
    return res.status(500).json({ message: `Could not run the fraud advisory: ${err.message}` });
  }
});

// Document upload / replace endpoints  → /api/claims/:claimId/documents
app.use('/api/claims', documentsRouter);

// Adjuster corrections to OCR fields    → /api/claims/:claimId/ocr
app.use('/api/claims', ocrRouter);

function runPythonAssessment(claimId) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(
            __dirname,
            '../scripts/policy_crosschecker.py'
        );

        const python = spawn('python', [
            pythonScript,
            claimId
        ]);

        let output = '';
        let errorOutput = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        python.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(errorOutput || `Python exited with code ${code}`));
                return;
            }

            try {
                const result = JSON.parse(output);
                resolve(result);
            } catch (error) {
                reject(new Error(
                    `Python returned invalid JSON: ${output}`
                ));
            }
        });
    });
}


app.post('/api/claims/:claimId/assessment', async (req, res) => {

  const db = client.db('stsp_db');
  const recommendationCollection =
    db.collection('recommendation_db');
   const { claimId } = req.params;
   const force = req.query.force === 'true';

    try {
        console.log(`Checking existing assessment for ${claimId}...`);

        console.log("claimId:", claimId);
        console.log("claimId type:", typeof claimId);

        // 1. Check recommendation_db first — skipped entirely when force=true,
        // which is how the Policy Rules card's retrigger button gets a fresh
        // AI run instead of just re-fetching the cached one.
        if (!force) {
            const existingAssessment = await recommendationCollection.findOne(
                { "Claim ID": claimId },
                { projection: { _id: 0 } }
            );

            // 2. If it already exists, return it
            if (existingAssessment) {
                console.log(`Found existing assessment for ${claimId}`);

                return res.json(existingAssessment);
            }
        }

        // 3. Otherwise run Python
        console.log(force
            ? `Forced re-assessment for ${claimId}. Running Python...`
            : `No assessment found for ${claimId}. Running Python...`);

        const result = await runPythonAssessment(claimId);

        // 4. Save Python's result to recommendation_db. upsert so a forced
        // re-run overwrites the prior result instead of throwing a
        // duplicate-key error on the second click.
        await recommendationCollection.replaceOne(
            { "Claim ID": claimId },
            result,
            { upsert: true }
        );

        console.log(`Assessment saved for ${claimId}`);

        // 5. Return the result to React
        return res.json(result);

    } catch (error) {
        console.error('Assessment failed:', error);

        return res.status(500).json({
            error: 'Assessment failed',
            message: error.message
        });
    }
});


async function start(){
  if(process.env.MONGO_URI){await mongoose.connect(process.env.MONGO_URI);console.log('Connected to MongoDB');}
  else console.warn('MONGO_URI is not set.');
  app.listen(PORT,()=>console.log(`InsureCopilot API running on http://localhost:${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1);});