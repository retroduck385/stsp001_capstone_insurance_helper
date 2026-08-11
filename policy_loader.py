import os
import json
from pydoc import text
from urllib import response
import pdfplumber
from google import genai
from dotenv import load_dotenv
from mongo_rules_store import RuleStore
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()
client = genai.Client()

#use gemini tokenizer to get token-length
def token_length(text):
    response = client.models.count_tokens(
        model="gemini-2.5-flash",
        contents=text
    )
    return response.total_tokens

def read_pdf_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(pages)

def extract_damage_payments() -> dict:
    text = """
         The Company will, subject to the Limits of Liability, indemnify the Insured against loss or damage to the Scheduled Vehicle and its accessories 
and spare parts whilst thereon:
(a)
by accidental collision or overturning, or collision or overturning consequent upon mechanical breakdown or consequent upon wear and 
tear;
(b)
(c)
(d)
2.
by fire, external explosion, self ignition or lightning or burglary, housebreaking or theft;
by malicious act;
Whilst in transit (including the process of loading and unloading) incidental to such transit by road, rail, inland waterway, lift or elevator.
At its own option, the Company may pay in cash the amount of the loss or damage, or may repair, reinstate or replace the Scheduled vehicle or 
any part thereof or its accessories or spare parts. The Liability of the Company shall not exceed the value of the parts lost or damaged and the 
reasonable cost of fitting such parts or the value of the Scheduled Vehicle at the time of the loss or damage, whichever is the less. The 
Insured’s estimate of value stated in the Schedule shall be the maximum amount payable by the Company in respect of any claim for loss or 
damage.
3.
In the event of claim being payable under Section III of this Policy for the cost of replacement parts, the amount of settlement shall be the cost 
of brand new part(s) to replace the damaged part(s) of the insured vehicle less the share of the Insured on the cost of the replacement parts 
computed based on the following depreciation schedule:
Age of Vehicle
Up to 3years
Over 3 years up to 4 years
Over 4 years up to 5 years
Over 5 years up to 6 years
Rate of Depreciation
Share of the Insured
Nil
20%
25%
30%
Age of Vehicle
Over 6 years up to 7 years
Over 7 years
Batteries, Tires, Ball Joints, Tie
Rods, and Shock Absorbers
(for Vehicles Over three (3) years old)
Rate of Depreciation
(Share of the Insured)
35%
40%
45%
It is further declared and agreed that in case of the total loss of the vehicle insured this clause shall not apply but the settlement shall be 
based of the provisions of Section III, Paragraph No. 2 of the Policy.
4. If the Scheduled Vehicle is disabled by reason of loss or damage insured under this Policy, the Company will, subject to the Limits of Liability 
for towing, bear the reasonable cost of protection and removal to the nearest repairer.
5. The insured may authorize the repair of the Scheduled Vehicle necessitated by damage for which the Company may be liable under this 
Policy, provided that:
(a) the estimated cost of such repair does not exceed the Authorized Repair Limit and;
(b) a detailed estimate of the cost is forwarded to the company without delay.
6. In the event of loss or damage to the Scheduled Vehicle or its accessories or spare parts necessitating the supply of a part not obtainable from 
stocks held in the Philippines, or in the event of the company exercising the option under Paragraph 2 to pay in cash the amount of the loss or 
damage, the liability of the Company in respect of any such part shall be limited to:
(a) (i) the price quote in the latest catalogue or price list issued by the Manufacturer of his Agents for the Philippines or
(ii) if no such catalogue or price list exists, the price last obtaining at the Manufacturer’s Work plus the reasonable cost of transport 
other than by air, to the Philippines, and the amount of the relative import duty, and;
(b) The reasonable cost of fitting such part
7. This policy shall be operative whilst the Scheduled Vehicle is being used for the purpose of towing any one disabled mechanically propelled 
vehicle provided that—
(a) such towed vehicle is not towed for reward;
(b) the Company shall not be liable in respect of damage to such towed vehicle or property being conveyed thereby
    """


    #split text
    splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50, length_function=token_length, separators=["\n\n", "\n", ". ", " "])
    chunks = splitter.split_text(text)

    ##embedding
    embedded_chunks = []
    for i,chunk in enumerate(chunks):
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=chunk,
            config = {
                "task_type": "retrieval_document",
                "title": f"section_III_chunk_{i}"
            }
        )
        embedded_chunks.append({
            "chunk_id": f"III-chunk-{i}",
            "text": chunk,
            "embedding": response.embeddings[0].values,
            "token_count": token_length(chunk)
        })

    ##store the chunks in collection
    store = RuleStore(connection_string = None, collection_name="loss_or_damage_policies")
    return store.insert_chunks(embedded_chunks)




def extract_general_exceptions() -> dict:
    text = """
        The Company shall not be liable under any Section of this Policy in respect of:
1. Any accident, or liability caused, or incurred
(a)
outside the Republic of the Philippines;
(b)
2.
whilst any MOTOR VEHICLE in respect of which indemnity is provided by this Policy is:
(i)    
being used otherwise than in accordance with the limitations as to use;
(ii)
    being drive by any person other than an Authorized Driver;
Any liability which attached by virtue of an agreement but which would not have attached in the absence of such agreement, except liability 
arising out of an on the spot agreement or amicable settlement of minor accident to avoid impairing the flow of traffic.
3. Except in respect of claims arising under Sections I and II of this Policy any accident, loss, damage or liability directly or indirectly, proximately 
or remotely occasioned by, contributed to by or traceable to, or arising out of, or in connection with flood, typhoon, hurricane, volcanic 
eruption, earthquake or other convulsion of nature, invasion, the act of foreign enemies, hostilities or warlike operations (whether war be 
declared or not), strike, riot, civil commotion, mutiny, rebellion, insurrection, military or usurped power, or by any direct or indirect 
consequences of any of the said occurrences and in the event of any claim hereunder, the Insured shall prove that the accident, loss or 
damage or liability arose independently of, and was in no way connected with, or occasioned by, or contributed to, any of the said 
occurrences, or any consequences thereof, and in default of such proof, the Company shall not be liable to make any payment in respect of 
such a claim.
4.Any sum which the Insured would have been entitled to recover from any party but for an agreement between the Insured and such party.
5.Bodily injury and/or death to any person in the employ of the Insured arising out of and in the course of such employment, or bodily injury 
and/or death to any member of the Insured’s household who is riding in the Scheduled Vehicle.
    """


    #split text
    splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50, length_function=token_length, separators=["\n\n", "\n", ". ", " "])
    chunks = splitter.split_text(text)

    ##embedding
    embedded_chunks = []
    for i,chunk in enumerate(chunks):
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=chunk,
            config = {
                "task_type": "retrieval_document",
                "title": f"Exception_chunk_{i}"
            }
        )
        embedded_chunks.append({
            "chunk_id": f"Exception-chunk-{i}",
            "text": chunk,
            "embedding": response.embeddings[0].values,
            "token_count": token_length(chunk)
        })

    ##store the chunks in collection
    store = RuleStore(connection_string = None, collection_name="general_exceptions")
    return store.insert_chunks(embedded_chunks)



def extract_injury_payments(pdf_path: str) -> dict:
    text = read_pdf_text(pdf_path)

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=[
            text,
            """You are a strict JSON extractor. Output ONLY valid JSON and nothing else.
Schema:
{
  "claims": [
    {
        "rule_id": "<unique_rule_id>",
        "category": "string",
        "description": "string",
        "conditions": {
            "loss_type": "string",
            "requires_evidence": boolean,
            "minimum_evidence": [
                "string"
            ]
        },
        "amount": {
            "currency": "PHP",
            "min": integer,
            "max": integer
        },
        "source": "string",
        "claim_period": {
            "unit": "days" | "months" | "years",
            "value": integer
        }
    }
  ]
}
For each injury or loss item in the policy, return one claim object that includes rule_id, category, description, conditions, amount, source, and claim_period.
If you are uncertain about a value, set it to null.
Do not include prose, markdown, or code fences. do a line break after each value

Category and loss type have the following heirarchy:

Category
│
├── injury
│   ├── fracture
│   ├── burn
│   ├── laceration
│   └── disability
|   |__ death
│
├── property
│   ├── fire_damage
│   ├── water_damage
│   ├── structural_damage
│   └── theft
│
├── vehicle
│   ├── collision
│   ├── theft
│   ├── vandalism
│   └── weather_damage
│
└── financial
    ├── income_loss
    ├── business_interruption
    └── medical_expense

An example of a valid JSON output is:
{
  "_id": "permanent_disablement_rule_5",
  "category": "injury",
  "loss_type": "disability",
  "description": "Loss of Arm at or Above elbow",
  "amount": {
    "min": 20000,
    "max": 20000,
    "currency": "PHP"
  },

  "claim_period": {
    "value": 60,
    "unit": "days",
  },

  "evidence": [
    "police_report",
    "photos",
    "repair_estimate"
  ]
}

"""
        ],
    )

    return response.text


def parse_json_response(response_text: str) -> dict:
    try:
        return json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "response.text is not valid JSON. Clean the model output or ensure the prompt returns only JSON.",
            exc,
            response_text,
        )


def store_rules_to_mongodb(response_text: str, connection_string: str | None = None) -> list[str]:
    data = parse_json_response(response_text)
    rules = data.get("claims", []) if isinstance(data, dict) else []
    if not isinstance(rules, list):
        raise ValueError("Expected a top-level 'claims' array in the Gemini JSON response")

    store = RuleStore(connection_string=connection_string, collection_name="injury_policies")
    return store.insert_rules(rules)


if __name__ == "__main__":
    pdf_file = r"C:\Users\river\Downloads\Car Insurance.pdf"
    response_text = extract_injury_payments(pdf_file)
    # inserted_ids = store_rules_to_mongodb(response_text, os.getenv("MONGODB_URI"))
    # inserted_chunks = extract_damage_payments(pdf_file)
    # print(f"Inserted chunks with id: , {inserted_chunks}")
    # print(f"Inserted rule documents with ids: {inserted_ids}")

    inserted_chunks = extract_general_exceptions()
    print(f"Inserted chunks with id: , {inserted_chunks}")