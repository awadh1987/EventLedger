import uuid
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.accounting import AccountingConfig, EventExpense, Invoice, JournalEntry, JournalLine
from app.models.events import Event


class DoubleEntryService:
    @staticmethod
    async def post_balanced_entry(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        created_by_id: uuid.UUID,
        reference: str,
        description: str,
        lines: list[dict],
        event_id: uuid.UUID | None = None,
    ) -> JournalEntry:
        total_debit = sum((Decimal(str(l.get("debit", 0))) for l in lines), Decimal("0.00"))
        total_credit = sum((Decimal(str(l.get("credit", 0))) for l in lines), Decimal("0.00"))
        if abs(total_debit - total_credit) >= Decimal("0.01") or total_debit <= Decimal("0.00"):
            raise HTTPException(status_code=400, detail=f"Unbalanced journal entry: debit={total_debit}, credit={total_credit}")

        entry = JournalEntry(
            tenant_id=tenant_id,
            event_id=event_id,
            entry_number=f"JE-{datetime.utcnow().year}-{str(uuid.uuid4().int % 1000000).zfill(6)}",
            reference=reference,
            description=description,
            status="POSTED",
            created_by_id=created_by_id,
        )
        db.add(entry)
        await db.flush()
        for l in lines:
            db.add(
                JournalLine(
                    journal_entry_id=entry.id,
                    account_id=l["account_id"],
                    debit=Decimal(str(l.get("debit", 0))),
                    credit=Decimal(str(l.get("credit", 0))),
                    memo=l.get("memo"),
                )
            )
        await db.commit()
        await db.refresh(entry)
        return entry

    @staticmethod
    async def record_verified_payment(
        db: AsyncSession,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        event_id: uuid.UUID,
        amount: Decimal,
        is_security_deposit: bool,
        payment_method: str,
        reference: str,
    ) -> JournalEntry:
        cfg = (await db.execute(select(AccountingConfig).where(AccountingConfig.tenant_id == tenant_id))).scalar_one_or_none()
        if not cfg:
            raise HTTPException(status_code=400, detail="AccountingConfig missing for tenant")

        debit_acc = cfg.cash_account_id if payment_method == "CASH" else cfg.bank_account_id
        credit_acc = cfg.security_deposit_liab_id if is_security_deposit else cfg.accounts_receivable_id
        return await DoubleEntryService.post_balanced_entry(
            db=db,
            tenant_id=tenant_id,
            created_by_id=user_id,
            reference=reference,
            description=f"Verified payment ({payment_method})",
            event_id=event_id,
            lines=[
                {"account_id": debit_acc, "debit": amount, "credit": Decimal("0.00"), "memo": reference},
                {"account_id": credit_acc, "debit": Decimal("0.00"), "credit": amount, "memo": reference},
            ],
        )

    @staticmethod
    async def get_event_pnl(db: AsyncSession, tenant_id: uuid.UUID, event_id: uuid.UUID) -> dict:
        event = (await db.execute(select(Event).where(Event.id == event_id, Event.tenant_id == tenant_id))).scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        invoices = (await db.execute(select(Invoice).where(Invoice.event_id == event_id, Invoice.tenant_id == tenant_id))).scalars().all()
        gross = sum((Decimal(str(i.subtotal)) for i in invoices), Decimal("0.00"))
        discounts = sum((Decimal(str(i.discount_amount)) for i in invoices), Decimal("0.00"))
        net_rev = gross - discounts

        expenses = (await db.execute(select(EventExpense).where(EventExpense.event_id == event_id, EventExpense.tenant_id == tenant_id))).scalars().all()
        total_exp = sum((Decimal(str(e.amount)) for e in expenses), Decimal("0.00"))
        profit = net_rev - total_exp

        return {
            "event_id": str(event.id),
            "event_code": event.event_code,
            "net_revenue": float(net_rev),
            "total_expenses": float(total_exp),
            "net_profit": float(profit),
            "margin_percent": float((profit / net_rev * 100).quantize(Decimal("0.01"))) if net_rev > 0 else 0.0,
        }
