from sqlalchemy import Column, Integer, String, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from pgvector.sqlalchemy import Vector

Base = declarative_base()

class Config(Base):
    __tablename__ = "configs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, unique=True)
    tg_token = Column(String, nullable=True)
    tg_admin_id = Column(String, nullable=True)
    llm_provider = Column(String, nullable=True)
    api_key = Column(String, nullable=True)
    proxy_url = Column(String, nullable=True) # Keep for backward compatibility
    base_url = Column(String, nullable=True)
    model_name = Column(String, nullable=True)
    proxy_config = Column(JSON, nullable=True) # {protocol, host, port, username, password}
    external_dbs = Column(JSON, nullable=True) # List of {type, name, connection_string}

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="user") # 'admin' or 'user'
    is_active = Column(Integer, default=1)

class Folder(Base):
    __tablename__ = "folders"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    parentId = Column(String, nullable=True)
    user_id = Column(Integer, index=True)
    updated_at = Column(String, nullable=True)
    password_hash = Column(String, nullable=True)

class Note(Base):
    __tablename__ = "notes"
    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=True)
    folderId = Column(String, nullable=True)
    user_id = Column(Integer, index=True)
    embedding = Column(Vector(384), nullable=True)
    isPinned = Column(Integer, default=0)
    updated_at = Column(String, nullable=True)

class Share(Base):
    __tablename__ = "shares"
    id = Column(String, primary_key=True, index=True)
    resource_id = Column(String, index=True)
    resource_type = Column(String) # 'note' or 'folder'
    owner_id = Column(Integer, index=True)
    target_user_id = Column(Integer, index=True, nullable=True)
    permission = Column(String) # 'read' or 'write'
    is_public = Column(Integer, default=0)

