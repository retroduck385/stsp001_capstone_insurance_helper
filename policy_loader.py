import json
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
    splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=50, length_function=token_length, separators=["\n\n", "\n", ". ", " "])
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
    store.db.drop_collection(store.collection)
    return store.insert_chunks(embedded_chunks, section = "damage_payments")




def extract_global_conditions_and_general_exceptions() -> dict:
    text = """
    GLOBAL CONDITIONS
        This Policy and the Schedule shall be read together, as one contract, and any word or expression to which a specific meaning has been attached in any part of this Policy or of the Schedule shall bear such specific meaning wherever it may appear.
Every notice or communication to be given or made under this Policy shall be delivered in writing to the Company.
The Insured shall take all reasonable steps to safeguard the Scheduled Vehicle from loss or damage and to maintain the Scheduled Vehicle in efficient condition, and the Company shall have at all times free and full access to examine the Scheduled Vehicle or any part thereof or any driver or employee of the Insured. In the event of any accident or breakdown, the Scheduled Vehicle shall not be left unattended without proper precaution being taken to prevent further loss or damage and if the Scheduled Vehicle be driven before the necessary repairs are effected, any extension of the damage or any further damage to the Scheduled Vehicle shall be excluded from the scope of the indemnity granted by this Policy.
In the event of any accident which may give rise to a claim under this Policy, the Insured shall, as soon as possible, give notice thereof to the Company with full particulars. Every letter, claim, writ, summons and process shall be notified or forwarded to the Company immediately on receipt. Notice shall also be given to the Company immediately as soon as the Insured shall have knowledge of any impending prosecution, inquest or fatal inquiry in connection with any such occurrence. In case of theft or other criminal act which may give rise to a claim under this Policy, the Insured shall give immediate notice to the Police and cooperate with the Company in securing the conviction of the offender.
Without prejudice to No. 2 of the General Exceptions, no admission, offer, promise or payment shall be made by or on behalf of the Insured without written consent of the Company which shall be entitled to take over the conduct in his name the defense or settlement of any claim, or to prosecute in his name for its own benefit any claim for indemnity or damages or otherwise, but shall not exercise any discretion prejudicial to the interest of the insured in the conduct of any proceedings in the settlement of any claim, and the Insured shall give all such information and assistance as the Company may require. If the Company shall with the consent of the Insured make any payment in settlement of any claim, and such payment includes any amount not covered by this Policy, the Insured shall repay the Company the amount not so covered.
At any time after the happening of any event giving rise to a claim or series of claims under this Policy, the Company may pay to the Insured and the Third Party claimant jointly the full amount of the Company’s liability and relinquish the conduct of any defense, settlements or proceedings, and the Company shall not be responsible for any damage alleged to have been caused to the Insured in consequence of any alleged action or omission of the Company in connection in such defense, settlement or proceedings or of the Company relinquishing such conduct, nor shall the Company be liable for any costs or expenses whatsoever incurred by the Insured or any claimant or other person after the Company shall have so relinquished.
The Company may cancel this Policy in accordance with Sections 64, 65, and 393 of the Insurance Code, in which case, the Company shall thereupon return to the Insured premiums paid less the pro rate portion thereof for the period when the Policy has been in force. The Insured may, at any time, cancel the Policy by surrendering it to the Company and (provided no claim has arisen during the then current period of Insurance) the insured shall be entitled to a return of the premium at the Company’s Short Period Rates for the period when the policy has been in force. However, in respect of Section I and II, the cancellation made by the Insured shall not be effective unless he has secured a similar policy of insurance of surety bond to replace the policy to be cancelled or make a cash deposit in sufficient amount with the Commissioner and without any gap file within (5) working days from date of cancellation the required documentation with the Bureau of Land Transportation in accordance with Section 394 of the Insurance Code.
If, at the time any claim arises under this Policy, there is any other Insurance covering the same loss, damage or liability, the Company shall not be liable to pay or contribute more than its ratable proportion of any loss, damage compensation, costs or expenses. Provided always that nothing in this Condition shall impose on the Company any liability from which but for this Condition, it would have been relieved under proviso (ii) of Section 1-2 (a) of this Policy.
Except in case of claims arising under Sections I and II of this Policy, if any difference of dispute shall arise with respect to the amount of the Company’s liability under this Policy, the same shall be referred to the decision of a single arbitrator, to be agreed upon by both parties or, failing such agreement of a single arbitrator, to the decision of two arbitrators, one to be appointed in writing by each of the parties within one calendar month after having been required in writing to do so by either of the parties and, in case of disagreement between the arbitrators, to the decision of an umpire who shall have been appointed in writing by the arbitrators, before entering on the reference, and the costs of and expenses incidental to the reference shall be dealt with in the award. And it is hereby expressly stipulated and declared that it shall be a condition precedent to any right of action or suit upon this Policy that the award by such arbitrators or umpire of the amount of the Company’s liability hereunder, if disputed, shall be first obtained. If a claim be made and rejected, and an action or suit be not commenced within twelve months after such rejection, or in case of an arbitration taking place as provided herein, within twelve months after the arbitrator or arbitrators or umpire shall have made their award, then the claim shall, for all purposes, be deemed to have been abandoned and shall not hereafter be recoverable hereunder. Provided, however, that in case of any dispute in the enforcement of the provisions of Section I and II of this Policy, the adjudication of such dispute shall be within the original and exclusive jurisdiction of the Insurance Commissioner, subject to the limitations provided in Section 430 of the Insurance Code, as amended.
The due observance and fulfillment of the Terms of this Policy, insofar as they relate to anything to be done or not be done by the Insured, and the truth of the statements and answer in the proposal, shall be conditions precedent to any liability of the Company to make any payment under this Policy.
In the event that the Company should pay or be held liable to pay any claim or claims under “No Fault” provision of the Insurance Code, the Insured shall reimburse the Company all such sums, whatsoever the Insured or his authorized driver or representative has committed a breach of any of the warranties, clauses or conditions of the Policy, or whenever the circumstances fall under any of the EXCEPTIONS listed in the Policy, for which the Company would not have been liable were it not for the application of the “No-Fault” provision of the Insurance Code.

    GENERAL EXCEPTIONS
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
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50, length_function=token_length, separators=["\n\n", "\n", ". ", " "])
    chunks = splitter.split_text(text)

    ##embedding
    embedded_chunks = []
    for i,chunk in enumerate(chunks):
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=chunk,
            config = {
                "task_type": "retrieval_document",
                "title": f"chunk_{i}"
            }
        )
        embedded_chunks.append({
            "chunk_id": f"chunk-{i}",
            "text": chunk,
            "embedding": response.embeddings[0].values,
            "token_count": token_length(chunk)
        })

    ##store the chunks in collection
    store = RuleStore(connection_string = None, collection_name="global_conditions_and_exceptions")
    store.db.drop_collection(store.collection)
    return store.insert_chunks(embedded_chunks, section = "global_conditions_and_exceptions")


def extract_injury_payments() -> dict:
    text = """
    SECTION I – LIABILITY TO THE PUBLIC

The Company will, subject to the Limits of Liability pay all sums necessary to discharge liability of the Insured in respect of bodily injury and/or death to any THIRD PARTY, in an accident caused by or arising out of the use of Scheduled Vehicle, provided that the Insured's liability shall have first been determined. In no case, however, shall the Company's total payment under both Section I and Section II combined exceed the Limits of Liability set forth herein. With respect to bodily injury and/or death to any party, the company's payment per victim in any one accident shall not exceed the limits indicated in the Schedule of Indemnities provided for this policy.
In terms of and subject to the limitations of this Policy, the Company will indemnify:-
(a) Any Authorized Driver who is driving the Scheduled Vehicle, provided that he:-
(i) Observes, fulfills, and be subject to the Terms of this Policy insofar as they can apply;
(ii) Is not entitled to indemnity under any other policy subject, however, to Condition No. 8 of the Conditions Applicable To All Sections.
(b) The Insured whilst personally driving a private motor car not belonging to him and not hired to him under a hire purchase agreement.
In the event of the death of any person entitled to indemnity under this Policy the Company will, in respect of the liability incurred to such person indemnify his personal representatives in terms of, and subject to the terms and conditions hereof.
The Company will pay all pertinent and reasonable costs and expenses incurred in connection with the accident.
In the event of accident involving indemnity under this Policy to more than one person, the Limits of Liability shall not exceed the aggregate amount so specified by law to all persons to be indemnified. Should indemnification both to liability of the Insured and that of another party (as provided under Authorized Driver) be provable, the Insured's shall have prior right thereto.
Unless the Insured objects, the Company shall:-
(a) arrange for representation at any inquest or investigation in respect of any death which may be the subject of indemnity under this Section
(b) undertake the defense in the Insurance Commission under Section 398 of the Insurance Code, or in any court of law, for alleged offenses causing, or relating to, any event which may be the subject to indemnity under this Section.


        SCHEDULE OF INDEMNITIES FOR BODILY INJURY AND/OR DEATH

The following Schedule of Indemnities shall be observed in the settlement of claims for death, bodily injuries and professional fees and hospital charges for services rendered to traffic accident victims under the Compulsory Motor Vehicle Liability Insurance Coverage.

A. DEATH INDEMNITY

Death Indemnity — P 70,000.00
Burial and Funeral Expenses — 30,000.00

B. BODILY INJURIES AND FRACTURES – Maximum

Loss of or Loss of use of:

Two Limbs — P 50,000.00
Both hands, or all fingers & both thumbs — 50,000.00
Both Feet — 50,000.00

Types of Accommodation or Professional Attendance / Extended Services Rendered — Reimbursement Fees and/or Charges:

Hospital Rooms — Maximum of 45 days per accident — P 500.00 / day
Surgical Expenses —
Major Operation — 2,000.00
Medium Operation — 7,500.00
Minor Operation — 5,000.00
Anesthesiologist's Fees —
Major Operation — 1,500.00
Medium Operation — 2,500.00
Minor Operation — 2,000.00
Operating Room —
Major Operation — 500.00
Medium Operation — 1,500.00
Minor Operation — 1,000.00
Medical Expenses — For daily visits of Practitioner or Specialist — 500.00
Laboratory examination fees, X-rays — The total amount of medical expenses must not exceed (for a single period of confinement) — 400.00 / day
Drugs & Medicine — Actual Value of drugs and medicine used but not to exceed — 5,000.00
Ambulance — Actual amount charged for ambulance transport but not to exceed — 20,000.00 (cross-reference note: 1,500.00 also appears associated with this line in the source layout — see note below)

C. PERMANENT DISABLEMENT AMOUNT

One Hand and one foot — 50,000.00
Sight of both eyes — 50,000.00
Injuries resulting in being permanently bedridden — 50,000.00
Any other injury causing permanent total disablement — 50,000.00
Arm at or above elbow — 20,000.00
Arm between elbow and wrist — 15,000.00
Hand — 15,000.00
Four fingers and thumb of one hand — 15,000.00
Four Fingers — 12,000.00
Leg at or above knee — 20,000.00
Leg below knee — 15,000.00
One foot — 15,000.00
All Toes of one foot — 10,000.00
Thumb — 8,000.00
Index Finger — 6,000.00
Sight of one Eye — 20,000.00
Hearing – Both Ears — 30,000.00
Hearing – One Ear — 15,000.00
        """
    
        #split text
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50, length_function=token_length, separators=["\n\n", "\n", ". ", " "])
    chunks = splitter.split_text(text)
    
    ##embedding
    embedded_chunks = []
    for i,chunk in enumerate(chunks):
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=chunk,
            config = {
                "task_type": "retrieval_document",
                "title": f"chunk_{i}"
            }
        )
        embedded_chunks.append({
            "chunk_id": f"chunk-{i}",
            "text": chunk,
            "embedding": response.embeddings[0].values,               
            "token_count": token_length(chunk)
        })
    
    ##store the chunks in collection
    store = RuleStore(connection_string = None, collection_name="injury_policies")
    store.db.drop_collection(store.collection)
    return store.insert_chunks(embedded_chunks, section = "injury_payments")
   


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
    # inserted_ids = store_rules_to_mongodb(response_text, os.getenv("MONGODB_URI"))
    # inserted_chunks = extract_damage_payments(pdf_file)
    # print(f"Inserted chunks with id: , {inserted_chunks}")
    # print(f"Inserted rule documents with ids: {inserted_ids}")
    # inserted_chunks = extract_general_exceptions()

     store = RuleStore(connection_string=None, collection_name="injury_policies")
     extract_damage_payments()
     extract_global_conditions_and_general_exceptions()
     extract_injury_payments()