import os
import datetime
from enum import Enum
from typing import List, Optional

from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, DateTime, Text, Boolean
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import csv
from io import StringIO

from openai import OpenAI

# ---------------- Settings ----------------

class Settings(BaseSettings):
    OPENAI_API_KEY: str

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)

DATABASE_URL = "sqlite:///./leadsense.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ---------------- Models ----------------

class LeadORM(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    # core fields
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    budget_min = Column(Float, nullable=True)
    budget_max = Column(Float, nullable=True)
    preferred_location = Column(String, nullable=True)
    property_type = Column(String, nullable=True)
    source = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # behavior tracking
    number_of_property_views = Column(Integer, default=0)
    time_spent_on_site = Column(Integer, default=0)  # seconds
    repeat_visits = Column(Integer, default=0)
    last_response_time_hours = Column(Float, default=None)  # hours since last broker outreach
    saved_properties_count = Column(Integer, default=0)
    random_location_browsing = Column(Boolean, default=False)

    # notes / AI fields
    notes = Column(Text, default="")
    ai_buyer_intent = Column(String, default=None)  # High/Medium/Low
    ai_buyer_type = Column(String, default=None)    # Investor/End-user/Casual browser
    ai_summary = Column(Text, default=None)

    # scoring
    lead_score = Column(Integer, default=0)
    lead_category = Column(String, default="Cold")  # Hot/Warm/Cold

    # recommendations
    next_best_action = Column(String, default=None)
    suggested_message = Column(Text, default=None)

    last_contacted_at = Column(DateTime, nullable=True)


Base.metadata.create_all(bind=engine)

# ---------------- Pydantic Schemas ----------------

class BuyerIntent(str, Enum):
    high = "High"
    medium = "Medium"
    low = "Low"


class BuyerType(str, Enum):
    investor = "Investor"
    end_user = "End-user"
    casual = "Casual browser"


class LeadBase(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    preferred_location: Optional[str] = None
    property_type: Optional[str] = None
    source: Optional[str] = None

    number_of_property_views: int = 0
    time_spent_on_site: int = 0  # seconds
    repeat_visits: int = 0
    last_response_time_hours: Optional[float] = None
    saved_properties_count: int = 0
    random_location_browsing: bool = False

    notes: str = ""


class LeadCreate(LeadBase):
    pass


class LeadUpdate(BaseModel):
    # allow partial updates
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    preferred_location: Optional[str] = None
    property_type: Optional[str] = None
    source: Optional[str] = None

    number_of_property_views: Optional[int] = None
    time_spent_on_site: Optional[int] = None
    repeat_visits: Optional[int] = None
    last_response_time_hours: Optional[float] = None
    saved_properties_count: Optional[int] = None
    random_location_browsing: Optional[bool] = None

    notes: Optional[str] = None


class LeadOut(BaseModel):
    id: int
    name: str
    email: Optional[str]
    phone: Optional[str]
    budget_min: Optional[float]
    budget_max: Optional[float]
    preferred_location: Optional[str]
    property_type: Optional[str]
    source: Optional[str]
    created_at: datetime.datetime

    number_of_property_views: int
    time_spent_on_site: int
    repeat_visits: int
    last_response_time_hours: Optional[float]
    saved_properties_count: int
    random_location_browsing: bool

    notes: str
    ai_buyer_intent: Optional[str]
    ai_buyer_type: Optional[str]
    ai_summary: Optional[str]

    lead_score: int
    lead_category: str

    next_best_action: Optional[str]
    suggested_message: Optional[str]
    last_contacted_at: Optional[datetime.datetime]

    class Config:
        orm_mode = True


# ---------------- Dependencies ----------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------- Scoring Logic ----------------

def score_lead(lead: LeadORM) -> None:
    score = 0

    # +25 → budget matches listings (MVP: if we actually have a sensible non-empty budget)
    if lead.budget_min is not None and lead.budget_max is not None:
        if lead.budget_min < lead.budget_max:
            score += 25

    # +20 → viewed properties 3+ times
    if lead.number_of_property_views >= 3:
        score += 20

    # +15 → responded within 1 hour
    if lead.last_response_time_hours is not None:
        if lead.last_response_time_hours <= 1:
            score += 15
        # -20 → no response in 3 days
        elif lead.last_response_time_hours >= 72:
            score -= 20

    # +10 → saved property
    if lead.saved_properties_count >= 1:
        score += 10

    # +10 → repeat visits
    if lead.repeat_visits >= 2:
        score += 10

    # -15 → random location browsing
    if lead.random_location_browsing:
        score -= 15

    # mild uplift for time on site
    if lead.time_spent_on_site >= 300:
        score += 10
    elif lead.time_spent_on_site >= 120:
        score += 5

    # clamp to 0–100
    score = max(0, min(100, score))

    if score >= 75:
        category = "Hot"
    elif score >= 45:
        category = "Warm"
    else:
        category = "Cold"

    lead.lead_score = score
    lead.lead_category = category


# ---------------- AI Intent & Recommendations ----------------

INTENT_SYSTEM_PROMPT = """
You are an assistant helping real estate brokers understand lead intent.
Given free-text notes, classify:

1. Buyer intent: High / Medium / Low
2. Buyer type: Investor / End-user / Casual browser
3. Short summary in 1–2 sentences, focused on purchase likelihood and timeline.

Respond in strict JSON with keys:
buyer_intent, buyer_type, summary
"""

def analyze_intent_and_recommendation(lead: LeadORM) -> None:
    content = f"""
Lead name: {lead.name}
Budget: {lead.budget_min} - {lead.budget_max}
Preferred location: {lead.preferred_location}
Property type: {lead.property_type}
Source: {lead.source}
Notes: {lead.notes}
Behavior:
  number_of_property_views={lead.number_of_property_views}
  time_spent_on_site={lead.time_spent_on_site}
  repeat_visits={lead.repeat_visits}
  saved_properties_count={lead.saved_properties_count}
  last_response_time_hours={lead.last_response_time_hours}
  random_location_browsing={lead.random_location_browsing}
Current score: {lead.lead_score} ({lead.lead_category})
"""

    chat_resp = openai_client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    import json
    parsed = json.loads(chat_resp.choices[0].message.content)

    lead.ai_buyer_intent = parsed.get("buyer_intent")
    lead.ai_buyer_type = parsed.get("buyer_type")
    lead.ai_summary = parsed.get("summary")

    # Next best action & suggested message
    nba_prompt = f"""
You are helping a real estate broker decide how to follow up with a lead.

Lead summary:
{lead.ai_summary}

Lead score: {lead.lead_score} ({lead.lead_category})
Buyer intent: {lead.ai_buyer_intent}
Buyer type: {lead.ai_buyer_type}

Pick ONE "next best action" from:
- Call now
- Send WhatsApp
- Send email
- Share similar properties
- Schedule site visit

Also generate a concise suggested message in less than 80 words
for the chosen channel. Make it specific and actionable, not generic.

Respond in JSON with keys:
next_best_action, message
"""
    nba_resp = openai_client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": "You specialize in sales follow-up strategy for real estate."},
            {"role": "user", "content": nba_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    nba_parsed = json.loads(nba_resp.choices[0].message.content)
    lead.next_best_action = nba_parsed.get("next_best_action")
    lead.suggested_message = nba_parsed.get("message")


# ---------------- FastAPI App ----------------

app = FastAPI(title="LeadSense AI – Real Estate Lead Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------- Utility: ORM -> Pydantic -------------

def orm_to_out(lead: LeadORM) -> LeadOut:
    return LeadOut.from_orm(lead)


# ---------------- Routes ----------------

@app.post("/add-lead", response_model=LeadOut)
def add_lead(payload: LeadCreate, db: Session = Depends(get_db)):
    lead = LeadORM(**payload.dict())
    score_lead(lead)
    analyze_intent_and_recommendation(lead)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return orm_to_out(lead)


@app.post("/score-lead/{lead_id}", response_model=LeadOut)
def rescore_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(LeadORM).filter(LeadORM.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    score_lead(lead)
    analyze_intent_and_recommendation(lead)
    db.commit()
    db.refresh(lead)
    return orm_to_out(lead)


@app.get("/get-leads", response_model=List[LeadOut])
def get_leads(
    category: Optional[str] = None,
    intent: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(LeadORM)
    if category:
        q = q.filter(LeadORM.lead_category == category)
    if intent:
        q = q.filter(LeadORM.ai_buyer_intent == intent)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (LeadORM.name.ilike(like)) |
            (LeadORM.email.ilike(like)) |
            (LeadORM.phone.ilike(like)) |
            (LeadORM.preferred_location.ilike(like))
        )
    # hottest first
    q = q.order_by(LeadORM.lead_score.desc(), LeadORM.created_at.desc())
    return [orm_to_out(l) for l in q.all()]


@app.get("/leads/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(LeadORM).filter(LeadORM.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return orm_to_out(lead)


@app.patch("/leads/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: int, payload: LeadUpdate, db: Session = Depends(get_db)):
    lead = db.query(LeadORM).filter(LeadORM.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(lead, field, value)
    score_lead(lead)
    analyze_intent_and_recommendation(lead)
    db.commit()
    db.refresh(lead)
    return orm_to_out(lead)


@app.post("/leads/upload-csv", response_model=List[LeadOut])
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = (await file.read()).decode("utf-8")
    reader = csv.DictReader(StringIO(content))
    created = []

    for row in reader:
        # Map CSV fields – expects headers matching these keys
        lead = LeadORM(
            name=row.get("name") or "Unknown",
            email=row.get("email"),
            phone=row.get("phone"),
            budget_min=float(row["budget_min"]) if row.get("budget_min") else None,
            budget_max=float(row["budget_max"]) if row.get("budget_max") else None,
            preferred_location=row.get("preferred_location"),
            property_type=row.get("property_type"),
            source=row.get("source"),
            number_of_property_views=int(row["number_of_property_views"] or 0)
            if row.get("number_of_property_views") else 0,
            time_spent_on_site=int(row["time_spent_on_site"] or 0)
            if row.get("time_spent_on_site") else 0,
            repeat_visits=int(row["repeat_visits"] or 0)
            if row.get("repeat_visits") else 0,
            last_response_time_hours=float(row["last_response_time_hours"])
            if row.get("last_response_time_hours") else None,
            saved_properties_count=int(row["saved_properties_count"] or 0)
            if row.get("saved_properties_count") else 0,
            random_location_browsing=row.get("random_location_browsing", "").lower() == "true",
            notes=row.get("notes") or "",
        )
        score_lead(lead)
        analyze_intent_and_recommendation(lead)
        db.add(lead)
        db.commit()
        db.refresh(lead)
        created.append(orm_to_out(lead))

    return created


@app.get("/dashboard/top-hot", response_model=List[LeadOut])
def get_top_hot_leads(db: Session = Depends(get_db), limit: int = 10):
    q = (
        db.query(LeadORM)
        .order_by(LeadORM.lead_score.desc(), LeadORM.created_at.desc())
        .limit(limit)
    )
    return [orm_to_out(l) for l in q.all()]


@app.get("/dashboard/daily-priority", response_model=List[LeadOut])
def get_daily_priority(db: Session = Depends(get_db), limit: int = 15):
    """
    Daily Priority:
    - Hot or Warm
    - Not contacted in last 24h OR never contacted
    - Sorted by score desc and oldest created_at first
    """
    now = datetime.datetime.utcnow()
    twenty_four_ago = now - datetime.timedelta(hours=24)

    q = (
        db.query(LeadORM)
        .filter(LeadORM.lead_category.in_(["Hot", "Warm"]))
        .filter(
            (LeadORM.last_contacted_at.is_(None)) |
            (LeadORM.last_contacted_at < twenty_four_ago)
        )
        .order_by(LeadORM.lead_score.desc(), LeadORM.created_at.asc())
        .limit(limit)
    )
    return [orm_to_out(l) for l in q.all()]


@app.post("/leads/{lead_id}/send-ai-message", response_model=LeadOut)
def send_ai_message(lead_id: int, db: Session = Depends(get_db)):
    """
    WhatsApp/message simulation.
    For MVP we just refresh suggested_message and bump last_contacted_at.
    """
    lead = db.query(LeadORM).filter(LeadORM.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Re-run intent & recommendation to refresh message
    analyze_intent_and_recommendation(lead)
    lead.last_contacted_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(lead)
    return orm_to_out(lead)


# --------------- Sample Data Seeder ---------------

@app.post("/dev/seed-sample-data")
def seed_sample_data(db: Session = Depends(get_db)):
    """
    Create ~20 fake leads with mixed behaviors (Hot, Warm, Cold).
    Idempotent-ish: skip if there are already 20+ leads.
    """
    count = db.query(LeadORM).count()
    if count >= 20:
        return {"message": "Already seeded", "total": count}

    import random

    names = [
        "Rahul Sharma", "Priya Singh", "Amit Verma", "Neha Gupta", "Rohit Mehta",
        "Karan Kapoor", "Sakshi Jain", "Vikram Rao", "Anjali Desai", "Mohit Bansal",
        "Arjun Khanna", "Pooja Nair", "Rakesh Yadav", "Simran Kaur", "Aditya Joshi",
        "Sneha Iyer", "Nikhil Patel", "Ishita Roy", "Manish Soni", "Kriti Malhotra",
    ]
    locations = ["Gurgaon", "Noida", "South Delhi", "Dwarka", "Mumbai", "Pune"]
    sources = ["Facebook", "Website", "Referral", "Walk-in", "Google Ads"]
    property_types = ["1BHK", "2BHK", "3BHK", "Villa", "Plot"]

    for i in range(20):
        hot = i < 7
        warm = 7 <= i < 15

        if hot:
            views = random.randint(4, 10)
            saved = random.randint(1, 3)
            repeat = random.randint(2, 5)
            time_spent = random.randint(300, 900)
            last_resp = random.uniform(0.1, 2.0)
            rand_loc = False
            notes = "Very engaged, asked about payment plan and wants to visit within 2 weeks."
        elif warm:
            views = random.randint(2, 5)
            saved = random.randint(0, 2)
            repeat = random.randint(1, 3)
            time_spent = random.randint(120, 600)
            last_resp = random.uniform(2, 48)
            rand_loc = random.choice([False, True])
            notes = "Interested but comparing options. Open to negotiation."
        else:
            views = random.randint(0, 2)
            saved = 0
            repeat = random.randint(0, 1)
            time_spent = random.randint(10, 180)
            last_resp = random.choice([None, random.uniform(72, 200)])
            rand_loc = random.choice([True, False])
            notes = "Browsing randomly, no clear requirements yet."

        budget_base = random.randint(40, 200) * 1e5  # INR-like
        lead = LeadORM(
            name=names[i],
            email=f"user{i+1}@example.com",
            phone=f"+91-9{random.randint(100000000, 999999999)}",
            budget_min=budget_base,
            budget_max=budget_base * 1.3,
            preferred_location=random.choice(locations),
            property_type=random.choice(property_types),
            source=random.choice(sources),
            number_of_property_views=views,
            time_spent_on_site=time_spent,
            repeat_visits=repeat,
            last_response_time_hours=last_resp,
            saved_properties_count=saved,
            random_location_browsing=rand_loc,
            notes=notes,
        )
        score_lead(lead)
        analyze_intent_and_recommendation(lead)
        db.add(lead)

    db.commit()
    total = db.query(LeadORM).count()
    return {"message": "Seeded sample leads", "total": total}
