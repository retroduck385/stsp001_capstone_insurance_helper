import json
import os
from google import genai
from dotenv import load_dotenv
from pymongo import MongoClient
import re

#initialize genAI client
load_dotenv()
client = genai.Client()

def parse_json_response(response_text: str) -> dict:
    cleaned = response_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "response.text is not valid JSON. Clean the model output or ensure the prompt returns only JSON.",
            exc,
            response_text,
        )

class PolicyCrossChecker:
    def __init__(self, db_name:str, resultdb:str, connection_string:str):
        #initialize connection to mongoDB
        connection_string = connection_string or os.getenv("MONGODB_URI")
        if not connection_string:
            raise ValueError("Set MONGODB_URI to a MongoDB connection string")
        self.client = MongoClient(connection_string)
        self.db = self.client[db_name]
        self.claim_collection = self.db["claims"]
        self.resultdb = resultdb

    def documentToString(self, claimID: str) -> str:

        #find the claim document with the given ObjectID
        claim_document = self.claim_collection.find_one({"id": claimID}, {"_id": 0})

        if not claim_document:
            raise ValueError(f"No claim document found with id: {claimID}")

        else:
            ocr = claim_document.get("ocrData", {})

            motor = claim_document.get("ocrData", {}).get("motorClaimForm", {})
            police = claim_document.get("ocrData", {}).get("policeReportOrAffidavit", {})
            medcert = claim_document.get("ocrData", {}).get("medicalCertificate", {})
            hospital = claim_document.get("ocrData", {}).get("hospitalBillSOA", {})
            death = claim_document.get("ocrData", {}).get("deathCertificate", {})
            funeral = claim_document.get("ocrData", {}).get("funeralExpenses", {})
            repair = claim_document.get("ocrData", {}).get("repairEstimate", {})
            damage_pics = claim_document.get("ocrData", {}).get("vehicleDamagePictures", {})
            no_claim_cert = claim_document.get("ocrData", {}).get("certificateOfNoClaim", {})


            text = f"""
            CLAIM
            Claim Type: {claim_document.get("claimType")}
            Status: {claim_document.get("status")}
            Category: {claim_document.get("category")}

            CLAIMANT
            Name: {claim_document.get("policyholder")}
            Driver Name: {claim_document.get("driverName")}

            """

            text+=f"""
            VEHICLE
            Year: {motor.get("vehicle_year")}
            Make: {motor.get("vehicle_make")}
            Model: {motor.get("vehicle_model")}
            Plate Number: {motor.get("vehicle_plate_no")}

            ACCIDENT
            Date: {motor.get("accident_date")}
            Time: {motor.get("accident_time")}
            Location: {motor.get("accident_place")}
            Weather: {motor.get("accident_weather")}
            Party At Fault: {motor.get("party_at_fault")}
            """

            if claim_document.get("claimType") == "Third-Party Bodily Injury / Death":
                # Third-party injury specific: affected persons
                affected = motor.get("affected_persons", [])
                if affected:
                    persons_text = "\n".join(f"- {p.get('name')}: {p.get('injury')}" for p in affected)
                    text+= f"""\nAFFECTED THIRD PARTY(IES)\n{persons_text}"""

                if medcert.get("diagnosis"):
                   text+=f"""\nMEDICAL CERTIFICATE
                    Patient: {medcert.get("patientName")}
                    Diagnosis: {medcert.get("diagnosis")}
                    Attending Physician: {medcert.get("attendingPhysician")}
                    """

                if hospital.get("totalAmountDue"):
                    text+=f"""\nHOSPITAL BILLS
                    Hospital: {hospital.get("hospitalName")}
                    Total Amount Due: PHP {hospital.get("totalAmountDue")}"""

                if police.get("incidentSummary"):
                    text+=f"""\nPOLICE REPORT
                    Reporting Officer: {police.get("reportingOfficer")}
                    Incident Summary: {police.get("incidentSummary")}"""

                # Only if this escalates to a death claim
                if death.get("deceasedName"):
                    text+=f"""\nDEATH CERTIFICATE
                    Deceased: {death.get("deceasedName")}
                    Date of Death: {death.get("dateOfDeath")}
                    Cause: {death.get("causeOfDeath")}"""

                if funeral.get("totalAmount"):
                    text+=f"""\nFUNERAL EXPENSES
                    Total Amount: PHP {funeral.get("totalAmount")}"""

            elif claim_document.get("claimType") == "Own Damage":
                                # Combine structured + free-text damage description
                damage_parts = motor.get("description_of_damage", [])
                if damage_parts:
                    parts_text = "\n".join(f"- {d.get('part')}: {d.get('extent')}" for d in damage_parts)
                    text+=f"""\nDAMAGE\n{parts_text}\nDescription: {damage_pics.get("damageDescription", "")}\nSeverity: {damage_pics.get("severity", "")}"""

                if repair.get("totalEstimatedCost"):
                    text+=f"""\nREPAIR ESTIMATE
                    Shop: {repair.get("shopName")}
                    Estimated Cost: PHP {repair.get("totalEstimatedCost")}
                    Affected Parts: {", ".join(repair.get("detectedParts", []))}"""

                if police.get("incidentSummary"):
                    text+=f"""\nPOLICE REPORT
                    Reporting Officer: {police.get("reportingOfficer")}
                    Incident Summary: {police.get("incidentSummary")}"""

            else:
                damage_parts = motor.get("description_of_damage", [])
                if damage_parts:
                    parts_text = "\n".join(f"- {d.get('part')}: {d.get('extent')}" for d in damage_parts)
                    text+=f"""\nTHIRD-PARTY VEHICLE DAMAGE\n{parts_text}\nDescription: {damage_pics.get("damageDescription", "")}\nSeverity: {damage_pics.get("severity", "")}"""

                if repair.get("totalEstimatedCost"):
                    text+=f"""\nREPAIR ESTIMATE (THIRD-PARTY VEHICLE)
                    Shop: {repair.get("shopName")}
                    Estimated Cost: PHP {repair.get("totalEstimatedCost")}
                    Affected Parts: {", ".join(repair.get("detectedParts", []))}"""

                if no_claim_cert.get("confirmationStatus"):
                    text+=f"""\nCERTIFICATE OF NO OWN DAMAGE CLAIM
                    Third-Party Insurer: {no_claim_cert.get("thirdPartyInsurerName")}
                    Status: {no_claim_cert.get("confirmationStatus")}
                    Issue Date: {no_claim_cert.get("issueDate")}"""

                if police.get("incidentSummary"):
                    text+=f"""\nPOLICE REPORT
                    Reporting Officer: {police.get("reportingOfficer")}
                    Incident Summary: {police.get("incidentSummary")}"""


            return text.strip()
    
    def search_multiple_collections(self, question, collections, top_k=5):
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
        definitions = f"""
        \n\n
        DEFINITIONS
        1. MOTOR VEHICLE is any vehicle as defined in Section Three, paragraph (a) of Republic Act – Numbered Four Thousand One Hundred Thirty-Six, 
        otherwise known as the “Land Transportation and Traffic Code".
        2. THIRD PARTY is any person other than a PASSENGER as defined in the law and shall also exclude a member of the household, or a member of 
        the family within the second degree of consanguinity or affinity, of a motor vehicle owner or his employee in respect of death, bodily injury or 
        damage to property arising out of and in the course of employment.
        """

        nuclearExclusionsClause = f"""
        \n\n
        NUCLEAR EXCLUSIONS CLAUSE
        1. This Policy does not cover:
        (a)
        Loss or destruction of, or damage to any property whatsoever or any loss or expense whatsoever resulting or arising therefrom, or any 
        consequential loss;
        (b)
        Any legal liability of whatsoever nature, directly or indirectly caused by, or contributed to by, or arising from, ionizing radiations or 
        contamination by radioactivity from any nuclear fuel, or from any nuclear waste from the combustion of nuclear fuel. For the purpose of 
        this exclusion only combustion shall include any self-sustaining process of nuclear fission.
        2. The Indemnity provided by this Policy shall not apply to nor include any loss, destruction, damage or legal liability directly or indirectly caused 
        by or contributed to, by or arising from, nuclear weapons material.
        """

        exceptionstoSectionIII = f"""
        \n\n
        EXCEPTIONS TO SECTION III
        The Company shall not be liable to pay for:-
        1. Loss or Damage in respect of any claim or series of claims arising out of one event, the first amount of each and every loss for each and every 
        2. vehicle Insured by this Policy, such amount being equal to one half of one percent (0.50%) of the Insured’s estimate of Fair Market Value as 
        3. shown in the Policy Schedule with a minimum deductible amount of PHP2,000.00;
        4. Consequential loss, depreciation, wear and tear, mechanical or electrical breakdowns, failures or breakages;
        5. Damage to tires, unless the Scheduled Vehicle is damaged at the same time;
        6. Any malicious damage caused by the Insured, any member of his family or by person in the Insured’s service.
        """

        sectionIV = f"""
        \n\n
        SECTION IV – EXCESS LIABILITY INSURANCE
        1. The Company will, subject to the Limits of Liability, reimburse the Insured for all sums actually paid by the Insured to discharge liability in 
        accordance with all provisions of Section I except the Limits of Liability for Section I but only in excess of:
        (a)
        The Limits of Liability for Sections I and II of this Policy, when such limits have been exhausted or;
        (b)
        The liability limits required for the scheduled vehicle under Section 390 of the Insurance Code, as amended in the event no coverage 
        exists as described in paragraph (a) above, Coverage under this paragraph is not subject to the Schedule of Indemnities under Section I.
        2. The Company will subject to the Limits of Liability, pay all sums necessary to discharge liability of the Insured, in respect of damage to Third 
        Party property in an accident caused by and arising out of the use of the Scheduled Vehicle, or in connection with the loading or unloading of 
        the Scheduled Vehicle, provided that the Insured’s liability shall have first been determined either by final court judgement after actual trial, or 
        by written agreement of the Insured, the Claimant, and the Company. Provided, further, that the Company shall not be liable in respect of 
        damage to property belonging to the insured, or held in trust by, or in the custody or control of the Insured or any member of the Insured’s 
        household, or being conveyed by the Scheduled Vehicle. For the purpose of this paragraph Scheduled Vehicle shall include any Private Car 
        whilst being personally driven by the Insured not belonging to him and not hired to him under a hire purchase agreement.
        
        """
        prompt = f"""
        You are an insurance policy cross-checking assistant.

        Your task is to determine whether the following insurance claim
        is supported, excluded, or unresolved based ONLY on the policy
        provisions provided below.

        DEFINITIONS
        -------------
        {definitions}

        RELEVANT POLICY PROVISIONS
        --------------------------
        {policy_context}

        EXCEPTIONS TO SECTION III TO TAKE NOTE OF
        ---------------------------------
        {exceptionstoSectionIII}

        SECTION IV
        ----------------------------------
        {sectionIV}

        NUCLEAR EXLCUSIONS CLAUSE
        ---------------------------------
        {nuclearExclusionsClause}


        CLAIM
        -----
        {claim_summary}

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

        Return the following format
        {{
        "Claim ID": "{claimID}",
        "Policy Status": "Covered / Not Covered / Requires Further Review",
        "Claimed Amount": amount in PHP,
        "Reccomended Payout": amount in PHP or 0 if not applicable,
        "relevant_provisions": [
            {{
                "section": "Policy section",
                "explanation": "Short explanation of why this provision is relevant"
            }}
        ],
        "exclusions_or_limitations": [
            {{
                "section": "Policy section",
                "explanation": "Short explanation of the applicable exclusion or limitation"
            }}
        ],
        "confidence": "High / Medium / Low"
        }}
        """

            # 5. Ask Gemini
        response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config={
                    "temperature": 0,
                }
            )

        return response.text

    def storeResult(self, result:str):
        result_dict = parse_json_response(result)
        self.db[self.resultdb].insert_one(result_dict)



#sample initializer of class, and function call of storeResult and cross_check_claim (the only two functions that should be relevant to the frontend)
crosschecker = PolicyCrossChecker(connection_string=None,db_name="stsp_db" , resultdb = "reccomendation_db", )
crosschecker.storeResult(crosschecker.cross_check_claim("CLM-2026-9001", ["injury_policies","global_conditions_and_exceptions", "loss_or_damage_policies"],top_k=5))

       


