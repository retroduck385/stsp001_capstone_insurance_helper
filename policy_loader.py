import os
import json
import pdfplumber
from google import genai
from dotenv import load_dotenv

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
        ]
    )

    return response.text


def save_json_from_text(response_text: str, output_path: str) -> str:
    try:
        data = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "response.text is not valid JSON. Clean the model output or ensure the prompt returns only JSON.",
            exc,
            response_text,
        )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return output_path


if __name__ == "__main__":
    pdf_file = r"C:\Users\river\Downloads\Car Insurance.pdf"
    response_text = extract_injury_payments(pdf_file)
    output_file = os.path.join(os.path.dirname(__file__), "policies", "policy_output.json")
    saved_path = save_json_from_text(response_text, output_file)
    print(f"Saved extracted JSON to: {saved_path}")