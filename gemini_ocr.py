import os
from google import genai
from dotenv import load_dotenv

# Load your .env file
load_dotenv()

# The new Client automatically looks for GEMINI_API_KEY in your .env file!
# No need for genai.configure() anymore.
client = genai.Client()

# Upload the image (Make sure "image_15bd30.jpg" matches your actual image name)
sample_file = client.files.upload(file="C:\\Users\\river\\Downloads\\ram.jpg")

# Prompt the model using the new syntax
response = client.models.generate_content(
    model='gemini-3.6-flash',
    contents=[
        sample_file, 
        "Explain what the picture contains."
    ]
)

print(response.text)