import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# PyInstaller 패키징 여부에 따라 SQLite DB 파일 경로 결정
IS_FROZEN = getattr(sys, 'frozen', False)
RUNNING_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_FILE = os.path.abspath(os.path.join(RUNNING_DIR, "fileshare.db"))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"

# sqlite의 경우, 멀티스레드 처리를 위해 check_same_thread=False 옵션 필요
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# DB 세션 디펜던시 주입용
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
