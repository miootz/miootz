from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.user import User
from app.core.config import settings
import random

router = APIRouter(prefix="/auth/sms", tags=["auth-sms"])

# Mock storage for OTPs: {phone: (otp, expiry)}
otp_store = {}


@router.post("/request")
async def request_sms_otp(phone: str):
    if settings.SMS_GATEWAY_MOCK:
        otp = str(random.randint(100000, 999999))
        otp_store[phone] = otp
        # In a real app, we would call Twilio/etc here
        return {"message": f"OTP sent to {phone} (Mock: {otp})"}

    raise HTTPException(status_code=501, detail="SMS Gateway not configured")


@router.post("/verify")
async def verify_sms_otp(phone: str, otp: str, db: AsyncSession = Depends(get_db)):
    stored_otp = otp_store.get(phone)
    if not stored_otp or stored_otp != otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    user = await db.get(User, 1)  # Simplified for mock; should search by phone
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    del otp_store[phone]
    return {"message": "Authenticated successfully", "user_id": user.id}
