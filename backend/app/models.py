from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Float, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

def now():
    return datetime.now(timezone.utc)

class Recording(Base):
    __tablename__ = 'recordings'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), default='local-owner', index=True)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(32), index=True)
    language: Mapped[str] = mapped_column(String(12), default='en')
    tags: Mapped[str] = mapped_column(Text, default='')
    notes: Mapped[str] = mapped_column(Text, default='')
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    size_bytes: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(70))
    storage_key: Mapped[str] = mapped_column(String(150))
    transcription_status: Mapped[str] = mapped_column(String(16), default='pending', index=True)
    transcription_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    segments: Mapped[list['Segment']] = relationship(cascade='all, delete-orphan', order_by='Segment.start_seconds', lazy='selectin')

class Segment(Base):
    __tablename__ = 'transcript_segments'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recording_id: Mapped[str] = mapped_column(ForeignKey('recordings.id', ondelete='CASCADE'), index=True)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)

Index('ix_recordings_owner_created', Recording.owner_id, Recording.created_at)
