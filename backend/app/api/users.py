from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from typing import List

from ..models import User
from ..main import get_db

router = APIRouter(prefix="/api/users", tags=["users"])

# Настройка passlib для хеширования паролей (pbkdf2_sha256)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr | None = None
    is_active: bool

    class Config:
        from_attributes = True

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """Создание нового пользователя (CRUD)."""
    
    # 1. Проверка существования email
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # 2. Хеширование пароля
    hashed_password = get_password_hash(user.password)
    
    # 3. Сохранение в БД
    new_user = User(
        username=user.username, 
        email=user.email, 
        hashed_password=hashed_password,
        is_active=1
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

@router.get("", response_model=List[UserResponse])
async def get_users(db: Session = Depends(get_db)):
    """Получить список всех пользователей."""
    users = db.query(User).all()
    return users
