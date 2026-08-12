import os
import json
import logging
from typing import Any, Dict, List, Optional
from pymongo import MongoClient
from pymongo.errors import PyMongoError

logger = logging.getLogger(__name__)


class RuleStore:
    def __init__(self, *, connection_string: Optional[str] = None, database_name: str = "stsp_db", collection_name: str):
        connection_string = connection_string or os.getenv("MONGODB_URI")
        if not connection_string:
            raise ValueError("Set MONGODB_URI to a MongoDB connection string")
        self.client = MongoClient(connection_string)
        self.db = self.client[database_name]
        self.collection = self.db[collection_name]

    def insert_rules(self, rules: List[Dict[str, Any]]) -> List[str]:
        self.db.drop_collection(self.collection)  # Clear the collection before inserting new rules
        if not rules:
            return []
        docs = []
        for rule in rules:
            doc = {
                "rule_id": rule.get("rule_id"),
                "category": rule.get("category"),
                "description": rule.get("description"),
                "conditions": rule.get("conditions") or {},
                "amount": rule.get("amount") or {},
                "source": rule.get("source"),
                "claim_period": rule.get("claim_period") or {},
            }
            docs.append(doc)
        result = self.collection.insert_many(docs)
        return [str(_id) for _id in result.inserted_ids]

    def insert_chunks(self, chunks: List[Dict[str, Any]], section: str) -> List[str]:
        for c in chunks:
           self.collection.insert_one({
                "chunk_id": c.get("chunk_id"),
                "policy_id": "axa_private_car_policy",
                "section": section,
                "text": c.get("text"),
                "embedding": c.get("embedding"),
                "token_count": c.get("token_count"),
            })

        return [str(c.get("chunk_id")) for c in chunks]

    def upsert_rule(self, rule: Dict[str, Any]) -> str:
        doc = {
            "rule_id": rule.get("rule_id"),
            "category": rule.get("category"),
            "conditions": rule.get("conditions") or {},
            "description": rule.get("description"),
            "amount": rule.get("amount") or {},
            "source": rule.get("source"),
            "claim_period": rule.get("claim_period") or {},
        }
        result = self.collection.update_one(
            {"rule_id": doc["rule_id"]},
            {"$set": doc},
            upsert=True,
        )
        return str(result.upserted_id or result.matched_count)
