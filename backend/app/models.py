from sqlalchemy import Column, Integer, String, Text
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Config(Base):
    __tablename__ = "configs"
    
    id = Column(Integer, primary_key=True, index=True)
    tg_token = Column(String, nullable=True)
    tg_admin_id = Column(String, nullable=True)
    llm_provider = Column(String, nullable=True)
    api_key = Column(String, nullable=True)
    proxy_url = Column(String, nullable=True)

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=False)

# Примечание: Для pgvector вам понадобится добавить:
# from pgvector.sqlalchemy import Vector
# class Note(Base):
#     __tablename__ = "notes"
#     id = Column(Integer, primary_key=True)
#     content = Column(Text)
#     embedding = Column(Vector(1536)) # размерность зависит от модели
