import os
import json
import pdfplumber
from google import genai
from dotenv import load_dotenv
from mongo_rules_store import RuleStore

load_dotenv()
client = genai.Client()


def read_pdf_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(pages)


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

    store = RuleStore(connection_string=connection_string)
    return store.insert_rules(rules)


if __name__ == "__main__":
    pdf_file = r"C:\Users\river\Downloads\Car Insurance.pdf"
    response_text = extract_injury_payments(pdf_file)
    inserted_ids = store_rules_to_mongodb(response_text, os.getenv("MONGODB_URI"))
    print(f"Inserted rule documents with ids: {inserted_ids}")