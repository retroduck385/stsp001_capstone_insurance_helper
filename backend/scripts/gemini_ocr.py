import sys
import os
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client()

# Catch the arguments passed from Node.js spawn()
file_path = sys.argv[1]
document_type = sys.argv[2]

# The strict prompt templates we defined earlier
drivers_license_prompt = """
You are an expert document extraction AI for the "STSP001 Capstone " project. Your task is to analyze the attached Philippine Driver's License image, extract the relevant details, and output the result STRICTLY as a valid JSON object.

GUARDRAILS:
1. Return ONLY the JSON object. Do not include conversational text, explanations, or markdown code blocks (like ```json).
2. Use the exact keys provided below. Do not change the casing or spelling.
3. If a field is missing, illegible, or not applicable on the license, set its value to exactly `null`.
4. Format all dates as "MM/DD/YYYY" if possible.
5. Transcribe ONLY what is physically printed on the card. Never calculate, infer or
   estimate a value from another field.
6. "driver_license_issue_date" in particular: many Philippine driver's licenses do NOT
   print an issue date at all. If you cannot see an issue date printed on the card,
   return exactly `null`. Do NOT derive it from the expiry date, the agency code, or
   the date of birth.
7. "driver_license_place_of_issue" is the LTO office / agency code printed on the card —
   it is not a date and must not be confused with the issue date.

Use this exact JSON structure:
{
  "driver_license_number": "string or null",
  "driver_license_name": "string or null",
  "driver_license_dob": "string or null",
  "driver_license_address": "string or null",
  "driver_license_class": "string or null",
  "driver_license_type": "string or null",
  "driver_license_issue_date": "string or null",
  "driver_license_expiry_date": "string or null",
  "driver_license_restrictions": "string or null",
  "driver_license_place_of_issue": "string or null",
  "driver_license_control_no": "string or null",
  "driver_license_blood_type": "string or null",
  "driver_license_official_receipt": "string or null"
}
"""

motor_claim_form_prompt = """
You are an expert document extraction AI for the "STSP001 Capstone " project. Your task is to analyze the attached Motor Claim Form image(s), extract all relevant details, and output the result STRICTLY as a valid JSON object.

GUARDRAILS:
1. Return ONLY the JSON object. Do not include conversational text or markdown code blocks (like ```json).
2. Use the exact keys provided below.
3. If a field is missing, set its value to `null`.
4. Format all dates as "MM/DD/YYYY".
5. For tables (affected_persons and description_of_damage), output an array of objects.
6. If Driver's Info is blank, assume Assured is the driver and map the data over.

Use this exact JSON structure:
{
  "assured_full_name": "string or null",
  "assured_dob": "string or null",
  "assured_place_of_birth": "string or null",
  "assured_sex": "string or null",
  "assured_nationality": "string or null",
  "assured_id_type": "string or null",
  "assured_id_no": "string or null",
  "assured_tin_sss_gsis": "string or null",
  "assured_email": "string or null",
  "assured_mobile": "string or null",
  "assured_home_phone": "string or null",
  "assured_address": "string or null",
  "assured_source_of_fund": "string or null",
  "assured_is_pep": "string or null",
  "vehicle_year": "string or null",
  "vehicle_model": "string or null",
  "vehicle_make": "string or null",
  "vehicle_type": "string or null",
  "vehicle_engine_no": "string or null",
  "vehicle_registered_owner": "string or null",
  "vehicle_chassis_no": "string or null",
  "vehicle_plate_no": "string or null",
  "driver_full_name": "string or null",
  "driver_age": "string or null",
  "driver_license_type": "string or null",
  "driver_license_no": "string or null",
  "driver_license_expiry": "string or null",
  "driver_address": "string or null",
  "driver_is_employee": "string or null",
  "driver_relationship": "string or null",
  "driver_authorized_by": "string or null",
  "accident_date": "string or null",
  "accident_time": "string or null",
  "accident_weather": "string or null",
  "accident_place": "string or null",
  "accident_police_authority": "string or null",
  "nature_of_business": "string or null",
  "purpose_of_use": "string or null",
  "vehicle_used_for_hire": "string or null",
  "registered_in_pami_tnvs": "string or null",
  "direction_during_accident": "string or null",
  "speed_rate_vehicle": "string or null",
  "direction_other_party": "string or null",
  "speed_rate_other_party": "string or null",
  "party_at_fault": "string or null",
  "settlements_made": "string or null",
  "reason_for_late_filing": "string or null",
  "affected_persons": [],
  "description_of_damage": [],
  "current_location_of_vehicle": "string or null",
  "payment_bank_name": "string or null",
  "payment_account_number": "string or null",
  "payment_account_name": "string or null",
  "authorization_text": "string or null"
}
"""

vehicle_damage_prompt = """
You are an expert claims adjuster AI for the "STSP001 Capstone " project. Your task is to analyze the attached vehicle damage image(s), assess the visible damage, and output the result STRICTLY as a valid JSON object.

GUARDRAILS:
1. Return ONLY the JSON object. Do not include conversational text or markdown code blocks.
2. Use the exact keys provided below.
3. For 'severity', classify the damage as one of the following: "Minor", "Moderate", "Heavy", or "Total Loss".
4. For 'damageDescription', provide a concise, factual summary of the visible damage (e.g., "Crushed front bumper and broken left headlight.").

Use this exact JSON structure:
{
  "damageDescription": "string or null",
  "severity": "string or null"
}
"""

# Determine the prompt based on the frontend document type
if document_type == "driversLicense":
    selected_prompt = drivers_license_prompt
elif document_type == "motorClaimForm":
    selected_prompt = motor_claim_form_prompt
elif document_type == "vehicleDamagePictures":
    selected_prompt = vehicle_damage_prompt
else:
    selected_prompt = "" # Fallback
    
try:
    # 1. Upload to Gemini
    uploaded_file = client.files.upload(file=file_path)

    # 2. Extract Data
    response = client.models.generate_content(
        model='gemini-3.5-flash',
        contents=[uploaded_file, selected_prompt],
        config={"response_mime_type": "application/json"}
    )
    
    # 3. Print ONLY the JSON to the console for Node.js to catch
    print(response.text)

except Exception as e:
    # Print error to stderr for Node.js to catch
    sys.stderr.write(str(e))
    sys.exit(1)