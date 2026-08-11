import json
import os
from google import genai
from dotenv import load_dotenv
from pymongo import MongoClient

#initialize genAI client
load_dotenv()
client = genai.Client()


class PolicyCrossChecker:
    def __init__(self, db_name:str, collection_name:str, connection_string:str):
        #initialize connection to mongoDB
        connection_string = connection_string or os.getenv("MONGODB_URI")
        if not connection_string:
            raise ValueError("Set MONGODB_URI to a MongoDB connection string")
        self.client = MongoClient(connection_string)
        self.db = self.client[db_name]
        self.collection = self.db[collection_name]
        self.claim_collection = self.db["claims"]

    def documentToString(self, claimID: str) -> str:

        #find the claim document with the given ObjectID
        claim_document = self.claim_collection.find_one({"id": claimID}, {"_id": 0})

        if not claim_document:
            raise ValueError(f"No claim document found with id: {claimID}")

        else:
            ocr = claim_document.get("ocrData", {})

            motor = ocr.get("motorClaimForm", {})
            police = ocr.get("policeReportOrAffidavit", {})
            repair = ocr.get("repairEstimate", {})
            damage = ocr.get("vehicleDamagePictures", {})

            text = f"""
            CLAIM
            Claim Type: {claim_document.get("claimType")}
            Status: {claim_document.get("status")}
            Category: {claim_document.get("category")}

            CLAIMANT
            Name: {claim_document.get("policyholder")}
            Driver Name: {claim_document.get("driverName")}


            VEHICLE
            Year: {motor.get("vehicle_year")}
            Make: {motor.get("vehicle_make")}
            Model: {motor.get("vehicle_model")}
            Type: {motor.get("vehicle_type")}
            Plate Number: {motor.get("vehicle_plate_no")}

            ACCIDENT
            Date: {motor.get("accident_date")}
            Time: {motor.get("accident_time")}
            Location: {motor.get("accident_place")}
            Weather: {motor.get("accident_weather")}
            Direction: {motor.get("direction_during_accident")}
            Speed: {motor.get("speed_rate_vehicle")}
            Party At Fault: {motor.get("party_at_fault")}
            Purpose of Use: {motor.get("purpose_of_use")}
            Vehicle Used For Hire: {motor.get("vehicle_used_for_hire")}

            DAMAGE
            Description: {damage.get("damageDescription")}
            Severity: {damage.get("severity")}

            REPAIR ESTIMATE
            Estimated Cost: PHP {repair.get("totalEstimatedCost")}
            Affected Parts: {", ".join(repair.get("detectedParts", []))}

            MEDICAL INFORMATION
            Medical Certificate: {ocr.get("medicalCertificate", "Not Provided")}

            HOSPITAL BILLS
            Total Amount: PHP {ocr.get("hospitalBillSOA", {}).get("totalAmountDue", "Not Provided")}

            POLICE REPORT
            Reporting Officer: {police.get("reportingOfficer")}
            Incident Summary: {police.get("incidentSummary")}
            """

            return text.strip()
    
    def search_multiple_collections(self, question, collections, top_k=8):
        # Embed the query once — reuse it across all collections
        response = client.models.embed_content(
                    model="gemini-embedding-001",
                    contents=question,
                    config = {
                        "task_type": "retrieval_query",
                    }
        )

        query_embedding = response.embeddings[0].values

        all_results = []
        for coll_name in collections:
            collection = self.db[coll_name]
            pipeline = [
                {
                    "$vectorSearch": {
                        "index": "vector_index",
                        "path": "embedding",
                        "queryVector": query_embedding,
                        "numCandidates": 50,
                        "limit": top_k
                    }
                },
                {
                    "$project": {
                        "text": 1,
                        "chunk_id": 1,
                        "score": {"$meta": "vectorSearchScore"},
                        "source_collection": {"$literal": coll_name}
                    }
                }
            ]
            results = list(collection.aggregate(pipeline))
            all_results.extend(results)

        # Merge across collections, re-rank globally by score, trim to top_k
        all_results.sort(key=lambda r: r["score"], reverse=True)
        return all_results[:top_k]


    def cross_check_claim(self, claimID: str, collections: list[str], top_k: int = 8):

        # 1. Get the claim
        claim_summary = self.documentToString(claimID)

        # 2. Retrieve relevant policy provisions
        results = self.search_multiple_collections(
            question=claim_summary,
            collections=collections,
            top_k=top_k
        )

        # 3. Build policy context
        policy_context = "\n\n".join(
            f"""
            POLICY PROVISION
            Source: {r["source_collection"]}
            Relevance Score: {r["score"]:.3f}

            {r["text"]}
            """
            for r in results
        )

        # 4. Build prompt for Gemini
        prompt = f"""
    You are an insurance policy cross-checking assistant.

    Your task is to determine whether the following insurance claim
    is supported, excluded, or unresolved based ONLY on the policy
    provisions provided below.

    CLAIM
    -----
    {claim_summary}


    RELEVANT POLICY PROVISIONS
    --------------------------
    {policy_context}

    INSTRUCTIONS
    ------------
    1. Determine which policy provisions are relevant to the claim.
    2. Identify provisions that support coverage.
    3. Identify provisions that exclude or limit coverage.
    4. Do not assume coverage simply because a provision is similar.
    5. Do not invent policy terms that are not present in the provided provisions.
    6. If the provided provisions are insufficient to determine coverage,
    say so explicitly.
    7. Explain your reasoning using the actual policy provisions.
    8. Calculate how much of the claim is covered, if applicable. (BE SURE TO INCLUDE THIS IF POSSIBLE)

    Return your answer in the following format:

    DECISION:
    [Covered / Not Covered / Requires Further Review]

    RELEVANT PROVISIONS:
    [List the relevant provisions]

    COVERAGE ANALYSIS:
    [Explain how the policy applies to the claim]

    EXCLUSIONS OR LIMITATIONS:
    [List applicable exclusions or limitations, or "None identified"]

    CONFIDENCE:
    [High / Medium / Low]
    """

        # 5. Ask Gemini
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        return response.text
            


checker = PolicyCrossChecker(
    db_name="stsp_db",
    collection_name="general_exceptions",
    connection_string=os.getenv("MONGODB_URI"))

claim_summary = checker.documentToString("CLM-2026-9001")
print(checker.cross_check_claim(claimID="CLM-2026-9001", collections=["global_conditions_and_exceptions", "injury_policies", "loss_or_damage_policies"], top_k=8))