import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import ApprovalStatus, DraftType, Event, EventDraft
from app.services.approvals_service import ApprovalsService

router = APIRouter(prefix="/api/v1", tags=["Drafts & Cross-ERP Approvals"])


class CreateDraftBody(BaseModel):
    draft_type: DraftType
    payload: dict
    financial_delta: Decimal = Decimal("0.00")
    created_by_id: uuid.UUID


class ResolveApprovalBody(BaseModel):
    approver_id: uuid.UUID
    decision: ApprovalStatus
    rejection_reason: str | None = None


@router.post("/events/{event_id}/drafts")
async def create_event_draft(event_id: uuid.UUID, body: CreateDraftBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    ev = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant.id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    max_v = (await db.execute(select(func.max(EventDraft.version_number)).where(EventDraft.event_id == event_id))).scalar() or 0
    draft = EventDraft(
        event_id=event_id,
        created_by_id=body.created_by_id,
        version_number=max_v + 1,
        draft_type=body.draft_type,
        payload=body.payload,
        financial_delta=body.financial_delta,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {"draft_id": str(draft.id), "version_number": draft.version_number, "status": draft.status.value}


@router.post("/drafts/{draft_id}/submit")
async def submit_draft(
    draft_id: uuid.UUID,
    request: Request,
    requester_id: uuid.UUID = Query(...),
    requester_type: str = Query(default="CLIENT_PRIMARY"),
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    approval = await ApprovalsService.submit_draft_for_approval(db, tenant.id, draft_id, requester_id, requester_type)
    return {"approval_id": str(approval.id), "required_approver_role": approval.required_approver_role}


@router.post("/approvals/{approval_id}/resolve")
async def resolve_approval(approval_id: uuid.UUID, body: ResolveApprovalBody, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await ApprovalsService.resolve_approval(db, tenant.id, approval_id, body.approver_id, body.decision, body.rejection_reason)
