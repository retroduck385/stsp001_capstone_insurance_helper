import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
const PORT = process.env.PORT || 5001;
app.use(cors());
app.use(express.json({limit:'10mb'}));

app.get('/api/health',(req,res)=>res.json({ok:true,service:'InsureCopilot API'}));

const claimSchema = new mongoose.Schema({
  id:{type:String,required:true,unique:true}, // matches your existing docs, e.g. "CLM-2026-8891"
  policyholder:String,
  email:String,
  driverName:String,
  vehicle:String,
  claimType:{type:String,enum:['Own Damage','Third-Party Property Damage','Third-Party Bodily Injury / Death']},
  status:String,
  category:String,
  claimedAmount:Number,
  recommendedPayout:Number,
  isFlagged:Boolean,
  flagSummary:String,
  docsCount:Number,
  documents:[mongoose.Schema.Types.Mixed],
  ocrData:[mongoose.Schema.Types.Mixed],
  rules:[mongoose.Schema.Types.Mixed],
  citation:String
},{
  timestamps:true,
  id:false, // disable Mongoose's default `id` virtual so it doesn't collide with our real `id` field
});

const Claim=mongoose.model('Claim',claimSchema);

app.get('/api/claims',async(req,res)=>{
  try{res.json(await Claim.find().sort({createdAt:-1}));}
  catch(e){res.status(500).json({message:e.message});}
});

async function start(){
  if(process.env.MONGO_URI){await mongoose.connect(process.env.MONGO_URI);console.log('Connected to MongoDB');}
  else console.warn('MONGO_URI is not set.');
  app.listen(PORT,()=>console.log(`InsureCopilot API running on http://localhost:${PORT}`));
}
start().catch(e=>{console.error(e);process.exit(1);});