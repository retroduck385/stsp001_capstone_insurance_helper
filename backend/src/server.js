// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import documentsRouter, { uploadsDir } from './routes/documents.js';
import ocrRouter from './routes/ocr.js';

const app = express();
const PORT = process.env.PORT || 5001;
app.use(cors());
app.use(express.json({limit:'10mb'}));

// Serve uploaded files back to the browser, e.g. /uploads/1755-license.jpg.
// Without this the files sit on disk but no <img> or <object> can reach them.
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health',(req,res)=>res.json({ok:true,service:'InsureCopilot API'}));

// const claimSchema = new mongoose.Schema({
//   id:{type:String,required:true,unique:true}, // matches your existing docs, e.g. "CLM-2026-8891"
//   policyholder:String,
//   email:String,
//   driverName:String,
//   vehicle:String,
//   claimType:{type:String,enum:['Own Damage','Third-Party Property Damage','Third-Party Bodily Injury / Death']},
//   status:String,
//   category:String,
//   claimedAmount:Number,
//   recommendedPayout:Number,
//   isFlagged:Boolean,
//   flagSummary:String,
//   docsCount:Number,
//   documents:[mongoose.Schema.Types.Mixed],
//   ocrData:[mongoose.Schema.Types.Mixed],
//   rules:[mongoose.Schema.Types.Mixed],
//   citation:String
// },{
//   timestamps:true,
//   id:false, // disable Mongoose's default `id` virtual so it doesn't collide with our real `id` field
// });

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
  recommendedPayout: Number,
  isFlagged: Boolean,
  flagSummary: String,
  docsCount: Number,
  documents: [mongoose.Schema.Types.Mixed],
  rules: [mongoose.Schema.Types.Mixed],
  citation: String,

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
      // driver_license_issue_date: { type: String, default: null },
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

// Document upload / replace endpoints  → /api/claims/:claimId/documents
app.use('/api/claims', documentsRouter);

// Adjuster corrections to OCR fields    → /api/claims/:claimId/ocr
app.use('/api/claims', ocrRouter);

async function start(){
  if(process.env.MONGO_URI){await mongoose.connect(process.env.MONGO_URI);console.log('Connected to MongoDB');}
  else console.warn('MONGO_URI is not set.');
  app.listen(PORT,()=>console.log(`InsureCopilot API running on http://localhost:${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1);});