import datetime
from sqlalchemy import Column, String, Integer, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Container(Base):
    __tablename__ = "containers"

    id = Column(String, primary_key=True, index=True)         # 컨테이너 ID (URL Path)
    password = Column(String, nullable=True)                  # 컨테이너 비밀번호 (평문 또는 해시, 단순화를 위해 평문 사용)
    created_at = Column(DateTime, default=datetime.datetime.now)

class FileMetadata(Base):
    __tablename__ = "file_metadata"

    id = Column(String, primary_key=True, index=True)          # 고유 UUID 또는 고유 해시 ID
    container_id = Column(String, ForeignKey("containers.id"), index=True, default="default") # 소속 컨테이너
    filename = Column(String, nullable=False)                 # 서버 디스크에 저장될 실제 유니크 파일명
    original_name = Column(String, nullable=False)            # 원본 파일명 (다운로드 시 필요)
    file_size = Column(Integer, nullable=False)               # 파일 크기 (Bytes)
    is_protected = Column(Boolean, default=False)             # 비밀번호 보호 여부
    folder_path = Column(String, default="")                  # 논리적 폴더 경로 (루트는 빈 문자열 "")
    is_directory = Column(Boolean, default=False)             # 폴더(디렉토리) 여부
    upload_time = Column(DateTime, default=datetime.datetime.now)  # 업로드 일시 (로컬 시간)
    download_count = Column(Integer, default=0)              # 누적 다운로드 횟수
