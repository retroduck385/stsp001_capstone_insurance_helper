import os
from google import genai
from dotenv import load_dotenv

drivers_license_ocr_prompt = """
You are an expert document extraction AI for the "STSP001 Capstone " project. Your task is to analyze the attached Philippine Driver's License image, extract the relevant details, and output the result STRICTLY as a valid JSON object.

GUARDRAILS:
1. Return ONLY the JSON object. Do not include conversational text, explanations, or markdown code blocks (like ```json).
2. Use the exact keys provided below. Do not change the casing or spelling.
3. If a field is missing, illegible, or not applicable on the license, set its value to exactly `null`.
4. Format all dates as "MM/DD/YYYY" if possible.

Use this exact JSON structure:
{
  "driver_license_number": "string or null",
  "driver_license_name": "string or null",
  "driver_license_dob": "string or null",
  "driver_license_address": "string or null",
  "driver_license_class": "string or null",
  "driver_license_expiry_date": "string or null",
  "driver_license_restrictions": "string or null",
  "driver_license_place_of_issue": "string or null",
  "driver_license_control_no": "string or null",
  "driver_license_blood_type": "string or null",
  "driver_license_official_receipt": "string or null"
}
"""
#   "driver_license_type": "string or null",
#   "driver_license_issue_date": "string or null",

# Load your .env file
load_dotenv()

# The new Client automatically looks for GEMINI_API_KEY in your .env file!
# No need for genai.configure() anymore.
client = genai.Client()

# Upload the image (Make sure "image_15bd30.jpg" matches your actual image name)
sample_file = client.files.upload(file="driver's license test.pdf")

# Prompt the model using the new syntax
response = client.models.generate_content(
    model='gemini-3.6-flash',
    contents= [
        sample_file, 
        drivers_license_ocr_prompt
    ]
)

print(response.text)