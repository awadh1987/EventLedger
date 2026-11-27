import uuid
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import AuthContext, get_current_auth, verify_event_access
from app.models.events import ApprovalRequest, ApprovalStatus, DraftType, Event, EventDraft
from app.models.users import User, UserType
from app.services.approvals_service import ApprovalsService

router = APIRouter(prefix="/api/v1", tags=["Drafts & Cross-ERP Approvals"])


class CreateDraftBody(BaseModel):
    draft_type: DraftType
    payload: dict
    financial_delta: Decimal = Decimal("0.00")


class ResolveApprovalBody(BaseModel):
    decision: Literal["APPROVED", "REJECTED", "RETURNED_FOR_AMENDMENT"]
    rejection_reason: Optional[str] = None


def _draft_delegate_perm(draft_type: DraftType) -> Optional[str]:
    if draft_type == DraftType.FLOOR_PLAN:
        return "canEditFloorplan"
    if draft_type == DraftType.ADDON_REQUEST:
        return "canRequestAddons"
    if draft_type == DraftType.CATERING_MENU:
        return "canEditCatering"
    return None


@router.post("/events/{event_id}/drafts")
async def create_event_draft(
    event_id: uuid.UUID,
    body: CreateDraftBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id, required_delegate_perm=_draft_delegate_perm(body.draft_type))

    max_v = (
        await db.execute(
            select(func.max(EventDraft.version_number)).where(
                EventDraft.event_id == event_id, EventDraft.tenant_id == auth.tenant_id
            )
        )
    ).scalar() or 0
    draft = EventDraft(
        tenant_id=auth.tenant_id,
        event_id=event_id,
        created_by_id=auth.user.id,
        version_number=max_v + 1,
        draft_type=body.draft_type,
        payload=body.payload,
        financial_delta=body.financial_delta,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {"draft_id": str(draft.id), "version_number": draft.version_number, "status": draft.status.value}


@router.get("/events/{event_id}/drafts")
async def list_event_drafts(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    await verify_event_access(db, auth, event_id)
    rows = (
        await db.execute(
            select(EventDraft, User.full_name)
            .join(User, EventDraft.created_by_id == User.id)
            .where(EventDraft.event_id == event_id, EventDraft.tenant_id == auth.tenant_id)
            .order_by(EventDraft.version_number.desc())
        )
    ).all()
    return [
        {
            "id": str(d.id),
            "version_number": d.version_number,
            "draft_type": d.draft_type.value,
            "payload": d.payload,
            "financial_delta": float(d.financial_delta),
            "status": d.status.value,
            "created_at": d.created_at.isoformat(),
            "created_by_name": full_name,
        }
        for d, full_name in rows
    ]


@router.post("/drafts/{draft_id}/submit")
async def submit_draft(
    draft_id: uuid.UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    draft = (
        await db.execute(select(EventDraft).where(EventDraft.id == draft_id, EventDraft.tenant_id == auth.tenant_id))
    ).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    await verify_event_access(db, auth, draft.event_id, required_delegate_perm=_draft_delegate_perm(draft.draft_type))
    approval, draft_status = await ApprovalsService.submit_draft_for_approval(
        db, auth.tenant_id, draft_id, auth.user.id, auth.user.user_type.value
    )
    return {
        "approval_id": str(approval.id),
        "required_approver_role": approval.required_approver_role,
        "draft_status": draft_status.value,
    }


@router.get("/approvals")
async def list_approvals(
    status: ApprovalStatus = Query(default=ApprovalStatus.PENDING),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    query = (
        select(ApprovalRequest, Event, EventDraft, User.full_name)
        .join(Event, ApprovalRequest.event_id == Event.id)
        .join(EventDraft, ApprovalRequest.draft_id == EventDraft.id)
        .join(User, ApprovalRequest.requested_by_id == User.id)
        .where(ApprovalRequest.tenant_id == auth.tenant_id, ApprovalRequest.status == status)
    )
    if auth.user.user_type != UserType.INTERNAL_STAFF:
        query = query.where(
            Event.primary_client_id == auth.user.id,
            ApprovalRequest.required_approver_role == "CLIENT_PRIMARY",
        )
    rows = (await db.execute(query.order_by(ApprovalRequest.created_at.desc()))).all()
    return [
        {
            "id": str(a.id),
            "event_id": str(ev.id),
            "event_code": ev.event_code,
            "draft_id": str(d.id),
            "draft_type": d.draft_type.value,
            "financial_delta": float(d.financial_delta),
            "required_approver_role": a.required_approver_role,
            "status": a.status.value,
            "requested_by_name": req_name,
            "created_at": a.created_at.isoformat(),
            "payload": d.payload,
        }
        for a, ev, d, req_name in rows
    ]


@router.post("/approvals/{approval_id}/resolve")
async def resolve_approval(
    approval_id: uuid.UUID,
    body: ResolveApprovalBody,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
):
    if not auth.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context required")
    return await ApprovalsService.resolve_approval(
        db=db,
        tenant_id=auth.tenant_id,
        approval_id=approval_id,
        approver_id=auth.user.id,
        approver_user_type=auth.user.user_type,
        approver_staff_role=auth.staff_role,
        decision=body.decision,
        rejection_reason=body.rejection_reason,
    )
