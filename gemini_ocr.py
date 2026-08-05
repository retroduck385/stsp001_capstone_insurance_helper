import os
from google import genai
from dotenv import load_dotenv

# Load your .env file
load_dotenv()

# The new Client automatically looks for GEMINI_API_KEY in your .env file!
# No need for genai.configure() anymore.
client = genai.Client()

# Upload the image (Make sure "image_15bd30.jpg" matches your actual image name)
sample_file = client.files.upload(file="b00eddce-cb0c-4399-a6a8-d7184b22b98a.jpeg")

# Prompt the model using the new syntax
response = client.models.generate_content(
    model='gemini-3.6-flash',
    contents=[
        sample_file, 
        "Extract all the text from this image verbatim. Do not add any other commentary."
    ]
)

print(response.text)