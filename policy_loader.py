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
      "injury": string | null,
      "amount": string | null,
      "currency": string | null,
      "evidence": string | null
    }
  ]
}
For each injury or loss item in the policy, return one object.
If you are uncertain about a value, set it to null.
Do not include prose, markdown, or code fences. do a line break after each value"""
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